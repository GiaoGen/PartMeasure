import { cookies } from "next/headers";
import { z } from "zod";
import { AppError, projectInput, uploadInput } from "@/lib/policy";
import { authClient, guest, owner } from "@/lib/server/auth";
import { digest, rate, token, transaction } from "@/lib/server/db";
import {
	body,
	csrf,
	endpoint,
	idemKey,
	response,
	uuid,
} from "@/lib/server/http";
import * as service from "@/lib/server/service";
import { storage, uploadGrant } from "@/lib/server/storage";
import { effectiveFileLimit } from "@/lib/server/file-limits";
import { fileResponse } from "@/lib/server/file-response";
import {
	createAnnotationSchema,
	updateAnnotationSchema,
	fileIssueSchema,
} from "@/lib/annotations";
import * as annotations from "@/lib/server/annotation-service";
import * as issues from "@/lib/server/issue-service";
import { measurementSchema, responseSchema, reviewSchema } from "@/lib/issues";
import { deliveryDraftSchema } from "@/lib/deliveries";
import * as deliveries from "@/lib/server/delivery-service";
import { appOrigin } from "@/lib/server/origin";
import { revisionFromHeaders } from "@/lib/revision";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ segments: string[] }> };
function expectedRevision(req: Request) {
	return revisionFromHeaders(req.headers);
}
const credentials = z
	.object({ email: z.email().max(254), password: z.string().min(12).max(128) })
	.strict();
async function handle(req: Request, context: Context) {
	return endpoint(async () => {
		const { segments: s } = await context.params;
		const method = req.method;
		const url = new URL(req.url);
		if (s.join("/") === "csrf" && method === "GET") {
			const jar = await cookies();
			const value = jar.get("pm_csrf")?.value ?? token();
			jar.set("pm_csrf", value, {
				httpOnly: true,
				sameSite: "strict",
				secure: appOrigin().startsWith("https:"),
				path: "/",
			});
			return response({ token: value });
		}
		if (method !== "GET") await csrf(req);
		if (s.join("/") === "upload-policy" && method === "GET")
			return response({ maxFileBytes: effectiveFileLimit() });
		if (s[0] === "auth") {
			// Email hashes only; never store passwords or OTP in application DB/logs.
			const action = s[1];
			const client = await authClient();
			if (action === "logout" && method === "POST") {
				const { error } = await client.auth.signOut();
				if (error) throw new AppError("AUTH_UNAVAILABLE", 503);
				return response({ signedOut: true });
			}
			if (action === "session" && method === "GET") {
				const actor = await owner();
				return response({ authenticated: true, id: actor.id });
			}
			if (method !== "POST") throw new AppError("NOT_FOUND", 404);
			if (action === "register" || action === "login") {
				const input = await body(req, credentials);
				await transaction(null, (db) => rate(db, "auth:global", 100, 600));
				await transaction(null, (db) =>
					rate(db, `auth:${digest(input.email.toLowerCase())}`, 5, 600),
				);
				const result =
					action === "register"
						? await client.auth.signUp(input)
						: await client.auth.signInWithPassword(input);
				if (result.error)
					throw new AppError(
						action === "login"
							? "INVALID_CREDENTIALS"
							: "REGISTRATION_UNAVAILABLE",
						action === "login" ? 401 : 422,
					);
				if (action === "register" && result.data.session) {
					await client.auth.signOut();
					throw new AppError("EMAIL_CONFIRMATION_REQUIRED_IN_AUTH_CONFIG", 503);
				}
				return response({ confirmationRequired: action === "register" });
			}
			if (action === "verify") {
				const input = await body(
					req,
					z
						.object({
							email: z.email().max(254),
							token: z.string().regex(/^\d{6,10}$/),
						})
						.strict(),
				);
				await transaction(null, (db) => rate(db, "verify:global", 100, 600));
				await transaction(null, (db) =>
					rate(db, `verify:${digest(input.email.toLowerCase())}`, 10, 600),
				);
				const { error } = await client.auth.verifyOtp({
					...input,
					type: "signup",
				});
				if (error) throw new AppError("OTP_INVALID_OR_EXPIRED", 422);
				return response({ verified: true });
			}
			throw new AppError("NOT_FOUND", 404);
		}
		if (s.join("/") === "guest/session" && method === "POST") {
			const { token: raw } = await body(
				req,
				z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict(),
			);
			// Header-derived IP is deliberately not trusted on arbitrary hosting. Global and token buckets are DB-backed.
			await transaction(null, (db) => rate(db, "bootstrap:global", 100));
			await transaction(null, (db) => rate(db, `bootstrap:${digest(raw)}`, 10));
			const result = await service.bootstrap(raw);
			(await cookies()).set(`pm_guest_${result.projectId}`, result.secret, {
				httpOnly: true,
				secure: appOrigin().startsWith("https:"),
				sameSite: "lax",
				path: "/",
				maxAge: 86400,
			});
			return response({ projectId: result.projectId });
		}
		const isGuest = s[0] === "guest";
		const parts = isGuest ? s.slice(1) : s;
		if (parts[0] !== "projects") throw new AppError("NOT_FOUND", 404);
		const projectId = parts[1];
		if (projectId && !uuid.safeParse(projectId).success)
			throw new AppError("NOT_FOUND", 404);
		const actor = isGuest
			? projectId
				? await guest(projectId)
				: (() => {
						throw new AppError("FORBIDDEN", 403);
					})()
			: await owner();
		const preflight = await transaction(actor, async (db) => {
			if (actor.kind === "guest") await rate(db, "guest:global", 600);
			try {
				if (actor.kind === "guest") {
					const permitted = await db.query(
						"select id from pm.projects where id=$1",
						[projectId],
					);
					if (!permitted.rows[0]) throw new AppError("LINK_UNAVAILABLE", 401);
				}
				await rate(
					db,
					`${service.actorKey(actor)}:${method === "GET" ? "read" : "write"}`,
					method === "GET" ? 120 : 60,
				);
				return null;
			} catch (error) {
				if (error instanceof AppError) return error;
				throw error;
			}
		});
		if (preflight) throw preflight;
		const cursor = url.searchParams.get("cursor");
		if (cursor && !uuid.safeParse(cursor).success)
			throw new AppError("INVALID_INPUT", 422);
		if (!projectId) {
			if (method === "GET")
				return response(await service.listProjects(actor, cursor));
			if (method === "POST")
				return response(
					await service.createProject(
						actor,
						await body(req, projectInput),
						idemKey(req),
					),
					201,
				);
		}
		if (!projectId) throw new AppError("NOT_FOUND", 404);
		const parsedPurpose = z
			.enum(["material", "delivery"])
			.safeParse(url.searchParams.get("purpose") ?? "material");
		if (!parsedPurpose.success) throw new AppError("INVALID_INPUT", 422);
		const purpose = parsedPurpose.data;
		const resource = parts[2],
			objectId = parts[3];
		if (objectId && !uuid.safeParse(objectId).success)
			throw new AppError("NOT_FOUND", 404);
		if (!resource) {
			if (method === "GET")
				return response(await service.projectDetail(actor, projectId));
			if (method === "PATCH") {
				const revision = expectedRevision(req);
				return response(
					await service.editProject(
						actor,
						projectId,
						await body(req, projectInput),
						revision,
						idemKey(req),
					),
				);
			}
		}
		if (resource === "deliveries") {
			if (actor.kind === "guest" && method !== "GET")
				throw new AppError("FORBIDDEN", 403);
			if (method === "GET" && !objectId)
				return response(await deliveries.listDeliveries(actor, projectId));
			if (method === "POST" && !objectId)
				return response(
					await deliveries.saveDelivery(
						actor,
						projectId,
						null,
						await body(req, deliveryDraftSchema),
						null,
						idemKey(req),
					),
					201,
				);
			if (objectId) {
				if (method === "GET" && !parts[4])
					return response(
						await deliveries.getDelivery(actor, projectId, objectId),
					);
				if (method === "PATCH" && !parts[4])
					return response(
						await deliveries.saveDelivery(
							actor,
							projectId,
							objectId,
							await body(req, deliveryDraftSchema),
							expectedRevision(req),
							idemKey(req),
						),
					);
				if (method === "POST" && parts[4] === "publish" && !parts[5]) {
					await body(req, z.object({}).strict());
					return response(
						await deliveries.publishDelivery(
							actor,
							projectId,
							objectId,
							expectedRevision(req),
							idemKey(req),
						),
						201,
					);
				}
				if (
					method === "GET" &&
					parts[4] === "files" &&
					parts[5] &&
					parts[6] === "download" &&
					!parts[7]
				) {
					const fileId = uuid.safeParse(parts[5]);
					if (!fileId.success) throw new AppError("NOT_FOUND", 404);
					const d = await deliveries.getDelivery(actor, projectId, objectId);
					if (!d.files.some((f) => f.id === fileId.data))
						throw new AppError("NOT_FOUND", 404);
					return fileResponse(
						req,
						await service.fileForRead(actor, projectId, fileId.data),
					);
				}
			}
			throw new AppError("NOT_FOUND", 404);
		}
		if (resource === "share-links") {
			if (method === "POST" && !objectId)
				return response(
					await service.rotateShare(actor, projectId, idemKey(req)),
					201,
				);
			if (method === "DELETE" && objectId)
				return response(
					await service.revokeShare(actor, projectId, objectId, idemKey(req)),
				);
		}
		if (resource === "annotations") {
			if (method !== "GET" && actor.kind === "guest")
				throw new AppError("FORBIDDEN", 403);
			if (method === "POST" && !objectId)
				return response(
					await annotations.createAnnotation(
						actor,
						projectId,
						await body(req, createAnnotationSchema),
						idemKey(req),
					),
					201,
				);
			if (objectId && method === "PATCH")
				return response(
					await annotations.changeAnnotation(
						actor,
						projectId,
						objectId,
						await body(req, updateAnnotationSchema),
						expectedRevision(req),
						idemKey(req),
					),
				);
			if (objectId && method === "DELETE")
				return response(
					await annotations.changeAnnotation(
						actor,
						projectId,
						objectId,
						null,
						expectedRevision(req),
						idemKey(req),
					),
				);
			if (objectId && method === "GET" && parts[4] === "revisions") {
				const before = url.searchParams.get("before");
				if (before && !/^[1-9]\d{0,8}$/.test(before))
					throw new AppError("INVALID_INPUT", 422);
				return response(
					await annotations.revisions(
						actor,
						projectId,
						objectId,
						before ? Number(before) : null,
					),
				);
			}
		}
		if (resource === "issues") {
			if (
				actor.kind === "guest" &&
				method !== "GET" &&
				!(objectId && parts[4] === "responses" && method === "POST")
			)
				throw new AppError("FORBIDDEN", 403);
			if (method === "GET" && !objectId)
				return response(await issues.listIssues(actor, projectId, cursor));
			if (method === "GET" && objectId && (!parts[4] || parts[4] === "history"))
				return response(await issues.detailIssue(actor, projectId, objectId));
			if (method === "POST" && objectId && parts[4] === "responses")
				return response(
					await issues.respondIssue(
						actor,
						projectId,
						objectId,
						await body(req, responseSchema),
						expectedRevision(req),
						idemKey(req),
					),
					201,
				);
			if (method === "POST" && objectId && parts[4] === "review")
				return response(
					await issues.reviewIssue(
						actor,
						projectId,
						objectId,
						await body(req, reviewSchema),
						expectedRevision(req),
						idemKey(req),
					),
					201,
				);
			if (method === "POST" && !objectId) {
				const input = await body(
					req,
					z.union([measurementSchema, fileIssueSchema]),
				);
				return response(
					"kind" in input
						? await issues.createMeasurement(
								actor,
								projectId,
								input,
								idemKey(req),
							)
						: await annotations.createFileIssue(
								actor,
								projectId,
								input,
								idemKey(req),
							),
					201,
				);
			}
		}
		if (resource === "uploads") {
			if (method === "GET" && !objectId)
				return response(
					await service.listReservations(actor, projectId, purpose),
				);
			if (method === "POST" && !objectId) {
				await transaction(actor, (db) =>
					rate(db, `reserve:${projectId}:${service.actorKey(actor)}`, 10),
				);
				return response(
					await service.reserve(
						actor,
						projectId,
						await body(req, uploadInput),
						idemKey(req),
					),
					201,
				);
			}
			if (objectId) {
				if (method === "POST" && parts[4] === "retry")
					return response(
						await service.retryProcessing(
							actor,
							projectId,
							objectId,
							idemKey(req),
						),
						202,
					);
				if (method === "POST" && parts[4] === "complete")
					return response(
						await service.reservation(
							actor,
							projectId,
							objectId,
							true,
							idemKey(req),
						),
						202,
					);
				if (method === "GET" && !parts[4]) {
					const { path: _path, ...state } = await service.reservation(
						actor,
						projectId,
						objectId,
					);
					return response(state);
				}
				if (method === "POST" && parts[4] === "grant") {
					const r = await service.reservation(actor, projectId, objectId);
					if (r.state !== "reserved") return response({ state: r.state });
					const existing = await storage()
						.from("partmeasure-quarantine")
						.info(r.path);
					if (!existing.error && existing.data)
						return response({ state: "uploaded" });
					await transaction(actor, async (db) => {
						await service.access(db, actor, projectId);
						const { rowCount } = await db.query(
							"update pm.upload_reservations set grant_expires_at=now()+interval '2 hours',cleanup_after=now()+interval '27 hours' where id=$1 and project_id=$2 and actor_key=$3 and state='reserved' and created_at>now()-interval '15 minutes'",
							[objectId, projectId, service.actorKey(actor)],
						);
						if (!rowCount) throw new AppError("UPLOAD_WINDOW_EXPIRED", 409);
					});
					return response({
						...(await uploadGrant(r.path)),
						bucket: "partmeasure-quarantine",
						supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
					});
				}
			}
		}
		if (resource === "files") {
			if (objectId && parts[4] === "annotations" && method === "GET")
				return response(
					await annotations.annotations(actor, projectId, objectId),
				);
			if (objectId && parts[4] === "issues" && method === "GET")
				return response(
					await issues.listIssues(actor, projectId, cursor, objectId),
				);
			if (method === "GET" && !objectId)
				return response(await service.files(actor, projectId, cursor, purpose));
			if (method === "DELETE" && objectId)
				return response(
					await service.deleteFile(actor, projectId, objectId, idemKey(req)),
				);
			if (
				method === "GET" &&
				objectId &&
				(parts[4] === "download" || parts[4] === "preview")
			) {
				const original = url.searchParams.get("original") === "1";
				const file = await service.fileForRead(
					actor,
					projectId,
					objectId,
					original,
				);
				return fileResponse(req, file, parts[4] === "preview", original);
			}
		}
		throw new AppError("NOT_FOUND", 404);
	});
}
export const GET = handle,
	POST = handle,
	PATCH = handle,
	DELETE = handle;
