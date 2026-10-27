import { cookies } from "next/headers";
import { z } from "zod";
import {
	AppError,
	projectInput,
	projectCreateInput,
	uploadInput,
	uploadPolicyDto,
} from "@/lib/policy";
import { folderInput, projectFiltersSchema } from "@/lib/project-folders";
import * as folders from "@/lib/server/folder-service";
import { authClient, guest, owner } from "@/lib/server/auth";
import { throttleAuth } from "@/lib/server/auth-throttle";
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
import { grantUpload } from "@/lib/server/upload-grant";
import { effectiveFileLimit } from "@/lib/server/file-limits";
import { fileResponse } from "@/lib/server/file-response";
import { fileAuthorizer } from "@/lib/server/file-authorizer";
import {
	createAnnotationSchema,
	updateAnnotationSchema,
	fileIssueSchema,
} from "@/lib/annotations";
import * as annotations from "@/lib/server/annotation-service";
import { annotatedExport } from "@/lib/server/annotated-export-service";
import { pdfReport } from "@/lib/server/pdf-report-service";
import { pdfSelectionSchema } from "@/lib/pdf-report";
import { parseZipSelection } from "@/lib/zip-package";
import { zipAccess, zipSnapshot } from "@/lib/server/zip-package-service";
import * as issues from "@/lib/server/issue-service";
import * as interaction from "@/lib/server/interaction-reads";
import { measurementSchema, responseSchema, reviewSchema } from "@/lib/issues";
import { deliveryDraftSchema, deliveryHistoryQuerySchema } from "@/lib/deliveries";
import * as deliveries from "@/lib/server/delivery-service";
import { feedbackInputSchema } from "@/lib/delivery-feedback";
import * as deliveryFeedback from "@/lib/server/delivery-feedback-service";
import { appOrigin } from "@/lib/server/origin";
import { revisionFromHeaders } from "@/lib/revision";
import { timed } from "@/lib/server/timing";
import { projectChanges } from "@/lib/server/project-changes";
import { archiveInputSchema, fileFiltersSchema } from "@/lib/archive-filters";
import { completeUpload } from "@/lib/server/complete-upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;
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
			return response(uploadPolicyDto(effectiveFileLimit()));
		if (s[0] === "auth") {
			// Email hashes only; never store passwords or OTP in application DB/logs.
			const action = s[1];
			const client = await authClient();
			if (action === "logout" && method === "POST") {
				const { error } = await timed("auth", () => client.auth.signOut());
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
				await throttleAuth("auth", input.email);
				const result = await timed("auth", () =>
					action === "register"
						? client.auth.signUp(input)
						: client.auth.signInWithPassword(input));
				if (result.error && (result.error.name === "AuthRetryableFetchError" || result.error.status === 0 || (result.error.status ?? 0) >= 500))
					throw new AppError("AUTH_UNAVAILABLE", 503);
				if (result.error?.status === 429) throw new AppError("RATE_LIMITED", 429);
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
				await throttleAuth("verify", input.email);
				const { error } = await timed("auth", () => client.auth.verifyOtp({
					...input,
					type: "signup",
				}));
				if (error && (error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status ?? 0) >= 500))
					throw new AppError("AUTH_UNAVAILABLE", 503);
				if (error?.status === 429) throw new AppError("RATE_LIMITED", 429);
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
		if (s[0] === "guest" && s[1] === "project-folders")
			throw new AppError("FORBIDDEN", 403);
		if (s[0] === "project-folders") {
			const actor = await owner();
			await transaction(actor, (db) =>
				rate(
					db,
					`${service.actorKey(actor)}:${method === "GET" ? "read" : "write"}`,
					method === "GET" ? 120 : 60,
				),
			);
			if (s.length !== 1) throw new AppError("NOT_FOUND", 404);
			if (method === "GET") return response(await folders.listFolders(actor));
			if (method === "POST")
				return response(
					await folders.createFolder(
						actor,
						await body(req, folderInput),
						idemKey(req),
					),
					201,
				);
			throw new AppError("METHOD_NOT_ALLOWED", 405);
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
		const preflight = await timed("preflight", () => transaction(actor, async (db) => {
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
		}));
		if (preflight) throw preflight;
		const cursor = url.searchParams.get("cursor");
		if (
			url.searchParams.getAll("cursor").length > 1 ||
			(cursor !== null && (cursor.length === 0 || cursor.length > 512))
		)
			throw new AppError("INVALID_INPUT", 422);
		if (projectId && parts[2] === "changes" && parts.length === 3 && method === "GET")
			return response(await projectChanges(actor, projectId, cursor));
		if (!projectId) {
			if (method === "GET") {
				for (const [key] of url.searchParams) {
					if (
						!["cursor", "q", "folderId", "sort", "status"].includes(key) ||
						url.searchParams.getAll(key).length !== 1
					)
						throw new AppError("INVALID_INPUT", 422);
				}
				if (
					url.searchParams.has("sort") &&
					url.searchParams.get("sort") !== "created-desc"
				)
					throw new AppError("INVALID_INPUT", 422);
				const filters = projectFiltersSchema.safeParse({
					q: url.searchParams.get("q") ?? "",
					folderId: url.searchParams.get("folderId"),
					status: url.searchParams.get("status") ?? "active",
				});
				if (!filters.success) throw new AppError("INVALID_INPUT", 422);
				return response(
					await service.listProjects(actor, cursor, filters.data),
				);
			}
			if (method === "POST")
				return response(
					await service.createProject(
						actor,
						await body(req, projectCreateInput),
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
		if ((resource === "zip-snapshot" || resource === "zip-access") && method === "GET" && parts.length === 3) {
			const selection = parseZipSelection(url.searchParams);
			return response(await (resource === "zip-snapshot" ? zipSnapshot : zipAccess)(actor, projectId, selection));
		}
		if (resource === "pdf-report" && method === "GET" && parts.length === 3) {
			if ([...url.searchParams.keys()].some(key => key !== "ids") || url.searchParams.getAll("ids").length !== 1) throw new AppError("INVALID_INPUT", 422);
			const selection = pdfSelectionSchema.safeParse({ fileIds: url.searchParams.get("ids")?.split(",") });
			if (!selection.success) throw new AppError("INVALID_INPUT", 422);
			return response(await pdfReport(actor, projectId, selection.data.fileIds));
		}
		if (method === "GET" && resource === "inbox" && parts.length === 3) {
			if ([...url.searchParams.keys()].some(key => !["cursor", "ids", "limit"].includes(key)) || url.searchParams.getAll("ids").length > 1 || url.searchParams.getAll("limit").length > 1 || (url.searchParams.has("ids") && (url.searchParams.has("cursor") || url.searchParams.has("limit")))) throw new AppError("INVALID_INPUT", 422);
			const limit = z.coerce.number().int().min(1).max(30).safeParse(url.searchParams.get("limit") ?? 30);
			if (!limit.success) throw new AppError("INVALID_INPUT", 422);
			const ids = url.searchParams.has("ids") ? interaction.inboxIds.safeParse(url.searchParams.get("ids")?.split(",")) : null;
			if (ids && !ids.success) throw new AppError("INVALID_INPUT", 422);
			return response(await interaction.inboxPage(actor, projectId, cursor, ids?.success ? ids.data : null, limit.data));
		}
		if (method === "GET" && resource === "image-access" && parts.length === 3) {
			if ([...url.searchParams.keys()].some(key => key !== "ids") || url.searchParams.getAll("ids").length !== 1) throw new AppError("INVALID_INPUT", 422);
			const ids = z.array(uuid).min(1).max(30).refine(values => new Set(values).size === values.length).safeParse(url.searchParams.get("ids")?.split(","));
			if (!ids.success) throw new AppError("INVALID_INPUT", 422);
			return response(await service.imageAccess(actor, projectId, ids.data));
		}
		if (method === "GET" && ["issue-views", "file-layers"].includes(resource ?? "") && !objectId) {
			if (parts.length !== 3 || [...url.searchParams.keys()].some(key => key !== "ids") || url.searchParams.getAll("ids").length !== 1)
				throw new AppError("INVALID_INPUT", 422);
			const ids = interaction.batchIds.safeParse(url.searchParams.get("ids")?.split(","));
			if (!ids.success) throw new AppError("INVALID_INPUT", 422);
			return response(resource === "file-layers" ? await interaction.layers(actor, projectId, ids.data) : await interaction.currentIssues(actor, projectId, ids.data));
		}
		if (objectId && !uuid.safeParse(objectId).success)
			throw new AppError("NOT_FOUND", 404);
		if (resource === "archive" && parts.length === 3 && method === "POST") {
			const input = await body(req, archiveInputSchema);
			return response(await service.archiveProject(actor, projectId, input.archived, expectedRevision(req), idemKey(req)));
		}
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
			if (objectId && parts[4] === "feedback" && parts.length === 5) {
				if ([...url.searchParams.keys()].some(key => key !== "cursor")) throw new AppError("INVALID_INPUT", 422);
				if (method === "GET") return response(await deliveryFeedback.listFeedback(actor, projectId, objectId, cursor));
				if (method === "POST") {
					if (url.searchParams.size) throw new AppError("INVALID_INPUT", 422);
					return response(await deliveryFeedback.addFeedback(actor, projectId, objectId, await body(req, feedbackInputSchema), idemKey(req)), 201);
				}
				throw new AppError("METHOD_NOT_ALLOWED", 405);
			}
			if (actor.kind === "guest" && method !== "GET")
				throw new AppError("FORBIDDEN", 403);
			if (method === "GET" && !objectId) {
				if (url.searchParams.has("view")) {
					const input = deliveryHistoryQuerySchema.safeParse(Object.fromEntries(url.searchParams));
					if (!input.success || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1))
						throw new AppError("INVALID_INPUT", 422);
					return response(await deliveries.listDeliveryHistory(actor, projectId, input.data.beforeVersion, input.data.cursor ?? null));
				}
				if (url.searchParams.size) throw new AppError("INVALID_INPUT", 422);
				return response(await deliveries.listDeliveries(actor, projectId));
			}
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
						await fileAuthorizer(actor, projectId, fileId.data),
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
			if (method === "GET" && objectId && !parts[5] && ["current", "history-page"].includes(parts[4] ?? "")) {
				if ([...url.searchParams.keys()].some(key => key !== "cursor")) throw new AppError("INVALID_INPUT", 422);
				if (parts[4] === "current") {
					if (cursor) throw new AppError("INVALID_INPUT", 422);
					return response((await interaction.currentIssues(actor, projectId, [objectId])).items[0]);
				}
				return response(await interaction.historyPage(actor, projectId, objectId, cursor));
			}
			if (method === "GET" && !objectId && url.searchParams.has("annotationId"))
				throw new AppError("INVALID_INPUT", 422);
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
				if (method === "POST" && ["retry", "complete"].includes(parts[4] ?? "") && !parts[5]) {
					idemKey(req);
					await body(req, z.object({}).strict());
					return response(await completeUpload(actor, projectId, objectId, req.signal));
				}
				if (method === "GET" && !parts[4]) {
					const { path: _path, ...state } = await service.reservation(
						actor,
						projectId,
						objectId,
					);
					return response(state);
				}
				if (method === "POST" && parts[4] === "grant") {
					return response(await grantUpload(actor, projectId, objectId, req.signal));
				}
			}
		}
		if (resource === "files") {
			if (method === "GET" && objectId && parts.length === 4) {
				if ([...url.searchParams].length) throw new AppError("INVALID_INPUT", 422);
				return response(await service.fileMetadata(actor, projectId, objectId));
			}
			if (method === "GET" && objectId && parts[4] === "annotated-export" && parts.length === 5) {
				if (!uuid.safeParse(objectId).success || url.searchParams.size !== 0) throw new AppError("INVALID_INPUT", 422);
				return response(await annotatedExport(actor, projectId, objectId));
			}
			if (method === "GET" && objectId && !parts[5] && ["interaction", "collaboration"].includes(parts[4] ?? "")) {
				const annotationId = url.searchParams.get("annotationId");
				if (!uuid.safeParse(annotationId).success || url.searchParams.getAll("annotationId").length !== 1 || [...url.searchParams.keys()].some(key => !["annotationId", "cursor"].includes(key)))
					throw new AppError("INVALID_INPUT", 422);
				return response(await interaction.fileInteraction(actor, projectId, objectId, annotationId as string, cursor, parts[4] === "interaction"));
			}
			if (objectId && parts[4] === "annotations" && method === "GET")
				return response(
					await annotations.annotations(actor, projectId, objectId),
				);
			if (objectId && parts[4] === "issues" && method === "GET") {
				const annotationId = url.searchParams.get("annotationId");
				if (
					(annotationId !== null && !uuid.safeParse(annotationId).success) ||
					url.searchParams.getAll("annotationId").length > 1
				)
					throw new AppError("INVALID_INPUT", 422);
				return response(
					await issues.listIssues(
						actor,
						projectId,
						cursor,
						objectId,
						annotationId,
					),
				);
			}
			if (method === "GET" && !objectId) {
				{
					if ([...url.searchParams.keys()].some(key => !["cursor", "purpose", "type", "sort"].includes(key) || url.searchParams.getAll(key).length !== 1)) throw new AppError("INVALID_INPUT", 422);
					const filters = fileFiltersSchema.safeParse({ type: url.searchParams.get("type") ?? "all", sort: url.searchParams.get("sort") ?? "created-desc" });
					if (!filters.success) throw new AppError("INVALID_INPUT", 422);
					return response(await service.files(actor, projectId, cursor, purpose, filters.data));
				}
			}
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
				const variant = url.searchParams.get("variant");
				if (variant !== null && (parts[4] !== "preview" || !["320","640"].includes(variant) || url.searchParams.getAll("variant").length !== 1)) throw new AppError("INVALID_INPUT",422);
				const authorize = await fileAuthorizer(
					actor,
					projectId,
					objectId,
					original,
					variant === null ? null : Number(variant),
				);
				return fileResponse(req, authorize, parts[4] === "preview", original);
			}
		}
		throw new AppError("NOT_FOUND", 404);
	});
}
export const GET = handle,
	POST = handle,
	PATCH = handle,
	DELETE = handle;
