// Disposable native PostgreSQL only. These fixtures never run against Supabase.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import * as projects from "../../src/lib/server/service";
import * as annotations from "../../src/lib/server/annotation-service";
import * as issues from "../../src/lib/server/issue-service";
import {
	claimUpload,
	finalizeUpload,
} from "../../src/lib/server/complete-upload";
import {
	type Actor,
	getPool,
	transaction,
	digest,
} from "../../src/lib/server/db";
import {
	emptyMetadata,
	type Annotation,
	type Geometry,
	type EngineeringMetadata,
} from "../../src/lib/annotations";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
	process.env.PM_EVENTS_LOCAL !== "disposable-native-pg" ||
	url.hostname !== "127.0.0.1" ||
	url.port !== "55448"
)
	throw Error("LOCAL_ONLY");
const admin = new pg.Client({
	host: "127.0.0.1",
	port: 55448,
	user: "postgres",
	database: "postgres",
	ssl: {
		rejectUnauthorized: true,
		ca: await readFile(process.env.DATABASE_CA_FILE ?? "", "utf8"),
	},
});
const A: Actor = { kind: "owner", id: randomUUID() },
	B: Actor = { kind: "owner", id: randomUUID() };
const results: { check: string; status: string; code?: string }[] = [];
async function check(check: string, work: () => Promise<void>) {
	try {
		await work();
		results.push({ check, status: "PASS" });
	} catch (e) {
		results.push({
			check,
			status: "FAIL",
			code: (e as { code?: string }).code ?? "ASSERTION_FAILED",
		});
	}
	console.log(JSON.stringify(results.at(-1)));
}
function present<T>(value: T | undefined): T {
	assert.ok(value);
	return value;
}
const rejects = (p: Promise<unknown>, code: string) =>
	assert.rejects(p, (e: { code?: string }) => e.code === code);
await admin.connect();
try {
	await admin.query("insert into auth.users(id) values($1),($2)", [A.id, B.id]);
	const project = await projects.createProject(
		A,
		{ name: "COLLAB synthetic local", description: "" },
		randomUUID(),
	);
	const link = await projects.rotateShare(A, project.id, randomUUID());
	const session = await projects.bootstrap(
		(link.url ?? "").split("/").at(-1) ?? "",
	);
	const G: Actor = { kind: "guest", hash: digest(session.secret) };
	const reservation = await projects.reserve(
		G,
		project.id,
		{
			filename: "sample.png",
			declaredMime: "image/png",
			byteSize: 8,
			sha256: "a".repeat(64),
		},
		randomUUID(),
	);
	const claim = await claimUpload(G, project.id, reservation.id);
	await finalizeUpload(G, claim.upload, {
		bytes: 8,
		hash: "a".repeat(64),
		key: `${project.id}/${reservation.id}/canonical.webp`,
		originalKey: `${project.id}/${reservation.id}/source`,
		mime: "image/webp",
		width: 1000,
		height: 800,
		normalizationVersion: 1,
		thumbnails: [],
	});
	const fileId = reservation.id;
	async function create(
		metadata: Partial<EngineeringMetadata> = {},
		geometry: Geometry = {
			type: "line",
			from: { x: 0.1, y: 0.2 },
			to: { x: 0.7, y: 0.2 },
		},
	) {
		return annotations.createAnnotation(
			A,
			project.id,
			{
				id: randomUUID(),
				fileId,
				imageHash: "a".repeat(64),
				metadata: { ...emptyMetadata(), ...metadata },
				geometry,
			},
			randomUUID(),
		);
	}
	const list = (a: Annotation) =>
		issues.listIssues(G, project.id, null, fileId, a.id);
	const update = (
		a: Annotation,
		metadata: Partial<EngineeringMetadata> = {},
		geometry = a.geometry,
	) =>
		annotations.changeAnnotation(
			A,
			project.id,
			a.id,
			{
				imageHash: "a".repeat(64),
				geometry,
				metadata: { ...a.metadata, ...metadata },
			},
			a.revision,
			randomUUID(),
		);
	const response = {
		kind: "numeric" as const,
		value: "12.5",
		unit: "mm" as const,
		body: "",
		evidenceFileIds: [],
		guestLabel: "",
	};
	let line: Annotation;
	await check(
		"save-automatically-opens-one-item-and-idempotent-replay",
		async () => {
			const input = {
					id: randomUUID(),
					fileId,
					imageHash: "a".repeat(64),
					metadata: emptyMetadata(),
					geometry: {
						type: "line" as const,
						from: { x: 0.1, y: 0.1 },
						to: { x: 0.8, y: 0.1 },
					},
				},
				key = randomUUID();
			line = await annotations.createAnnotation(A, project.id, input, key);
			await annotations.createAnnotation(A, project.id, input, key);
			assert.equal((await list(line)).items.length, 1);
			line = await update(line, { name: "Length" });
			assert.equal((await list(line)).items.length, 1);
		},
	);
	await check(
		"numeric-review-writes-human-value-and-revision-in-same-transaction",
		async () => {
			const item = present((await list(line)).items[0]);
			const reply = await issues.respondIssue(
				G,
				project.id,
				item.id,
				response,
				item.revision,
				randomUUID(),
			);
			await issues.reviewIssue(
				A,
				project.id,
				item.id,
				{
					decision: "confirm",
					responseId: reply.responseId,
					value: "12.5",
					unit: "mm",
					source: "customer_numeric",
					note: "",
				},
				reply.revision,
				randomUUID(),
			);
			const doc = await annotations.annotations(G, project.id, fileId);
			line = present(doc.items.find((a) => a.id === line.id));
			assert.equal(line.metadata.dimension, "12.5");
			assert.ok(line.revision > 2);
			assert.equal(present((await list(line)).items[0]).state, "confirmed");
			assert.equal(
				(await issues.detailIssue(G, project.id, item.id)).responses.length,
				1,
			);
		},
	);
	await check(
		"direct-fill-closes-pending-and-closed-reply-is-rejected",
		async () => {
			let a = await create();
			const i = present((await list(a)).items[0]);
			a = await update(a, { dimension: "120" });
			assert.ok(present((await list(a)).items[0]).closedAt);
			await rejects(
				issues.respondIssue(
					G,
					project.id,
					i.id,
					response,
					i.revision,
					randomUUID(),
				),
				"CLOSED_MEASUREMENT",
			);
			assert.ok(
				!(await issues.listIssues(G, project.id, null)).items.some(
					(row) => row.id === i.id,
				),
			);
		},
	);
	await check(
		"description-only-point-text-and-prefilled-have-no-pending-items",
		async () => {
			for (const a of [
				await create({ measurementMode: "none" }),
				await create({}, { type: "point", at: { x: 0.2, y: 0.2 } }),
				await create(
					{},
					{ type: "text", at: { x: 0.2, y: 0.2 }, text: "Note" },
				),
				await create({ dimension: "10" }),
			])
				assert.equal((await list(a)).items.length, 0);
		},
	);
	await check(
		"hole-diameter-and-depth-are-independent-and-units-stay-physical",
		async () => {
			const a = await create(
				{ requireHoleDepth: true, dimension: "25.4", unit: "mm" },
				{
					type: "circle",
					center: { x: 0.5, y: 0.5 },
					radiusX: 0.1,
					radiusY: 0.125,
				},
			);
			const item = present((await list(a)).items[0]);
			assert.equal(item.measurementField, "holeDepth");
			const r = await issues.respondIssue(
				G,
				project.id,
				item.id,
				{ ...response, value: "2", unit: "in" },
				item.revision,
				randomUUID(),
			);
			await issues.reviewIssue(
				A,
				project.id,
				item.id,
				{
					decision: "confirm",
					responseId: r.responseId,
					value: "2",
					unit: "in",
					source: "customer_numeric",
					note: "",
				},
				r.revision,
				randomUUID(),
			);
			const saved = present(
				(await annotations.annotations(G, project.id, fileId)).items.find(
					(i) => i.id === a.id,
				),
			);
			assert.equal(saved.metadata.dimension, "1");
			assert.equal(saved.metadata.holeDepth, "2");
			assert.equal(saved.metadata.unit, "in");
		},
	);
	await check(
		"unable-remeasure-photo-manual-review-appends-history",
		async () => {
			const a = await create();
			const i = present((await list(a)).items[0]);
			const first = await issues.respondIssue(
				G,
				project.id,
				i.id,
				{
					kind: "unable",
					body: "no tool",
					evidenceFileIds: [],
					guestLabel: "",
				},
				i.revision,
				randomUUID(),
			);
			const redo = await issues.reviewIssue(
				A,
				project.id,
				i.id,
				{
					decision: "remeasure",
					responseId: first.responseId,
					value: null,
					unit: null,
					source: null,
					note: "photo please",
				},
				first.revision,
				randomUUID(),
			);
			const photo = await issues.respondIssue(
				G,
				project.id,
				i.id,
				{ kind: "photo", body: "", evidenceFileIds: [fileId], guestLabel: "" },
				redo.revision,
				randomUUID(),
			);
			await issues.reviewIssue(
				A,
				project.id,
				i.id,
				{
					decision: "confirm",
					responseId: photo.responseId,
					value: "15",
					unit: "mm",
					source: "owner_from_photo",
					note: "read by engineer",
				},
				photo.revision,
				randomUUID(),
			);
			const detail = await issues.detailIssue(G, project.id, i.id);
			assert.equal(detail.responses.length, 2);
			assert.equal(detail.reviews.length, 2);
			assert.equal(detail.target?.annotation.metadata.dimension, "");
		},
	);
	await check(
		"geometry-change-closes-old-snapshot-and-stale-review-cannot-apply",
		async () => {
			let a = await create();
			const old = present((await list(a)).items[0]);
			const reply = await issues.respondIssue(
				G,
				project.id,
				old.id,
				response,
				old.revision,
				randomUUID(),
			);
			a = await update(
				a,
				{},
				{ type: "line", from: { x: 0.1, y: 0.4 }, to: { x: 0.7, y: 0.4 } },
			);
			const entries = (await list(a)).items;
			assert.equal(entries.length, 2);
			assert.equal(entries.filter((i) => !i.closedAt).length, 1);
			await rejects(
				issues.reviewIssue(
					A,
					project.id,
					old.id,
					{
						decision: "confirm",
						responseId: reply.responseId,
						value: "12.5",
						unit: "mm",
						source: "customer_numeric",
						note: "",
					},
					reply.revision,
					randomUUID(),
				),
				"CLOSED_MEASUREMENT",
			);
			assert.equal(
				(await issues.detailIssue(G, project.id, old.id)).responses.length,
				1,
			);
		},
	);
	await check(
		"revision-conflict-double-submit-and-role-isolation",
		async () => {
			const a = await create();
			const i = present((await list(a)).items[0]);
			const key = randomUUID();
			const first = await issues.respondIssue(
				G,
				project.id,
				i.id,
				response,
				i.revision,
				key,
			);
			assert.equal(
				(
					await issues.respondIssue(
						G,
						project.id,
						i.id,
						response,
						i.revision,
						key,
					)
				).responseId,
				first.responseId,
			);
			await rejects(
				issues.respondIssue(
					G,
					project.id,
					i.id,
					response,
					i.revision,
					randomUUID(),
				),
				"REVISION_CONFLICT",
			);
			await rejects(update({ ...a, revision: 999 }), "REVISION_CONFLICT");
			await rejects(
				annotations.changeAnnotation(
					G,
					project.id,
					a.id,
					null,
					a.revision,
					randomUUID(),
				),
				"FORBIDDEN",
			);
			await rejects(issues.listIssues(B, project.id, null), "NOT_FOUND");
			await rejects(
				issues.reviewIssue(
					G,
					project.id,
					i.id,
					{
						decision: "confirm",
						responseId: first.responseId,
						value: "12.5",
						unit: "mm",
						source: "customer_numeric",
						note: "",
					},
					first.revision,
					randomUUID(),
				),
				"FORBIDDEN",
			);
			await rejects(
				transaction(G, (db) =>
					db.query(
						"update pm.issues set closed_at=now(),closed_by=$3,closure_note='forged',closure_annotation_revision=1,revision=revision+1 where project_id=$1 and id=$2",
						[project.id, i.id, A.id],
					),
				),
				"23514",
			);
		},
	);
	await check(
		"legacy-locator-request-review-does-not-write-invalid-point-dimension",
		async () => {
			const point = await create({}, { type: "point", at: { x: 0.2, y: 0.2 } });
			const i = await issues.createMeasurement(
				A,
				project.id,
				{
					kind: "measurement",
					fileId,
					annotationRef: { id: point.id, revision: point.revision },
					title: "Legacy",
					targetInfo: "Legacy measurement",
					description: "",
					measurementMethod: "unspecified",
				},
				randomUUID(),
			);
			const r = await issues.respondIssue(
				G,
				project.id,
				i.id,
				response,
				i.revision,
				randomUUID(),
			);
			await issues.reviewIssue(
				A,
				project.id,
				i.id,
				{
					decision: "confirm",
					responseId: r.responseId,
					value: "12.5",
					unit: "mm",
					source: "customer_numeric",
					note: "",
				},
				r.revision,
				randomUUID(),
			);
			assert.equal(
				(await annotations.annotations(G, project.id, fileId)).items.find(
					(a) => a.id === point.id,
				)?.metadata.dimension,
				"",
			);
			assert.equal(
				(await issues.detailIssue(G, project.id, i.id)).state,
				"confirmed",
			);
		},
	);
	await check(
		"concurrent-different-submissions-commit-one-append-only-response",
		async () => {
			const a = await create();
			const i = present((await list(a)).items[0]);
			const attempts = await Promise.allSettled([
				issues.respondIssue(
					G,
					project.id,
					i.id,
					response,
					i.revision,
					randomUUID(),
				),
				issues.respondIssue(
					G,
					project.id,
					i.id,
					{ ...response, value: "14" },
					i.revision,
					randomUUID(),
				),
			]);
			assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
			assert.equal(
				(await issues.detailIssue(G, project.id, i.id)).responses.length,
				1,
			);
		},
	);
	await check(
		"revocation-removes-access-to-integrated-attributes",
		async () => {
			await projects.revokeShare(A, project.id, link.id, randomUUID());
			await rejects(
				annotations.annotations(G, project.id, fileId),
				"LINK_UNAVAILABLE",
			);
		},
	);
} finally {
	await admin.end();
	await getPool().end();
	await mkdir("docs/evidence/annotation-collaboration", { recursive: true });
	await writeFile(
		"docs/evidence/annotation-collaboration/native.json",
		`${JSON.stringify({ checkedAt: new Date().toISOString(), scope: "Disposable native PostgreSQL: transactions/RLS; no real Auth/Storage/browser evidence", results }, null, 2)}\n`,
	);
}
if (results.some((r) => r.status !== "PASS")) process.exitCode = 1;
