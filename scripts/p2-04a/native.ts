// Disposable PostgreSQL checks only; synthetic identities and file metadata, no real Auth/Storage.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import * as service from "../../src/lib/server/service";
import * as annotations from "../../src/lib/server/annotation-service";
import * as issues from "../../src/lib/server/issue-service";
import { annotatedExport } from "../../src/lib/server/annotated-export-service";
import {
	claimUpload,
	finalizeUpload,
} from "../../src/lib/server/complete-upload";
import { digest, getPool, type Actor } from "../../src/lib/server/db";
import { emptyMetadata, type Geometry } from "../../src/lib/annotations";
import { exportDescription } from "../../src/lib/annotated-export";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
	process.env.PM_EVENTS_LOCAL !== "disposable-native-pg" ||
	url.hostname !== "127.0.0.1" ||
	url.port !== "55448"
)
	throw Error("LOCAL_ONLY");
const admin = new pg.Client({
	host: url.hostname,
	port: 55448,
	user: "postgres",
	database: "postgres",
	ssl: {
		rejectUnauthorized: true,
		ca: await readFile(process.env.DATABASE_CA_FILE ?? "", "utf8"),
	},
});
const A = { kind: "owner" as const, id: randomUUID() },
	B = { kind: "owner" as const, id: randomUUID() };
const results: { check: string; status: string }[] = [];
await admin.connect();
try {
	await admin.query("insert into auth.users(id) values($1),($2)", [A.id, B.id]);
	const project = await service.createProject(
		A,
		{ name: "导出合成零件", description: "" },
		randomUUID(),
	);
	const other = await service.createProject(
		B,
		{ name: "另一工程师", description: "" },
		randomUUID(),
	);
	const share = await service.rotateShare(A, project.id, randomUUID());
	const session = await service.bootstrap(
		(share.url ?? "").split("/").at(-1) ?? "",
	);
	const G: Actor = { kind: "guest", hash: digest(session.secret) };
	const hash = "a".repeat(64);
	const file = await service.reserve(
		A,
		project.id,
		{
			filename: "正面.png",
			byteSize: 8,
			declaredMime: "image/png",
			sha256: hash,
			purpose: "material",
		},
		randomUUID(),
	);
	const claim = await claimUpload(A, project.id, file.id);
	await finalizeUpload(A, claim.upload, {
		bytes: 8,
		hash,
		originalKey: `${project.id}/${file.id}/source`,
		key: `${project.id}/${file.id}/canonical.webp`,
		mime: "image/webp",
		width: 800,
		height: 600,
		normalizationVersion: 1,
		thumbnails: [],
	});
	const geometries: Geometry[] = [
		{ type: "line", from: { x: 0.1, y: 0.1 }, to: { x: 0.8, y: 0.1 } },
		{ type: "circle", center: { x: 0.5, y: 0.5 }, radiusX: 0.15, radiusY: 0.2 },
		{ type: "point", at: { x: 0.1, y: 0.2 } },
		{ type: "text", at: { x: 0.5, y: 0.5 }, text: "中文原备注" },
		{
			type: "angle",
			from: { x: 0.2, y: 0.5 },
			vertex: { x: 0.5, y: 0.5 },
			to: { x: 0.5, y: 0.2 },
			reflex: false,
		},
		{
			type: "arc",
			from: { x: 0.2, y: 0.5 },
			via: { x: 0.5, y: 0.2 },
			to: { x: 0.8, y: 0.5 },
		},
		{
			type: "ellipse",
			center: { x: 0.5, y: 0.5 },
			axisA: { x: 0.7, y: 0.5 },
			axisB: { x: 0.5, y: 0.65 },
		},
	];
	for (const geometry of geometries)
		await annotations.createAnnotation(
			A,
			project.id,
			{
				id: randomUUID(),
				fileId: file.id,
				imageHash: hash,
				geometry,
				metadata: emptyMetadata(),
			},
			randomUUID(),
		);
	const list = await issues.listIssues(G, project.id, null, file.id, null);
	const first = list.items.find(
		(item) => item.measurementField === "dimension",
	);
	assert.ok(first);
	await issues.respondIssue(
		G,
		project.id,
		first.id,
		{
			kind: "numeric",
			value: "12.5",
			unit: "mm",
			body: "卡尺人工读数",
			evidenceFileIds: [],
			guestLabel: "",
		},
		first.revision,
		randomUUID(),
	);
	const saved = await annotatedExport(G, project.id, file.id);
	assert.equal(saved.document.items.length, 7);
	assert.equal(saved.document.image.imageHash, hash);
	assert.ok(saved.issues.some((item) => item.response?.value === "12.5"));
	assert.match(exportDescription(saved).join("\n"), /12.5 mm（客户回复数值）/);
	assert.ok(!JSON.stringify(saved).includes("storage_key"));
	results.push({
		check: "runtime_guest_snapshot_seven_geometries_source_and_hash",
		status: "PASS",
	});
	await assert.rejects(annotatedExport(B, project.id, file.id), {
		code: "NOT_FOUND",
	});
	await assert.rejects(annotatedExport(G, other.id, file.id));
	await assert.rejects(annotatedExport(A, other.id, file.id), {
		code: "NOT_FOUND",
	});
	results.push({
		check: "runtime_rls_cross_owner_and_project_rejected",
		status: "PASS",
	});
	const item = saved.document.items.find(
		(item) => item.geometry.type === "text",
	);
	assert.ok(item);
	await annotations.changeAnnotation(
		A,
		project.id,
		item.id,
		{
			imageHash: hash,
			geometry: { type: "text", at: { x: 0.5, y: 0.5 }, text: "后来备注" },
			metadata: item.metadata,
		},
		item.revision,
		randomUUID(),
	);
	assert.match(exportDescription(saved).join("\n"), /中文原备注/);
	assert.doesNotMatch(exportDescription(saved).join("\n"), /后来备注/);
	const next = await annotatedExport(A, project.id, file.id);
	assert.match(exportDescription(next).join("\n"), /后来备注/);
	assert.notEqual(next.snapshotId, saved.snapshotId);
	results.push({
		check: "captured_export_not_mixed_with_later_saved_revision",
		status: "PASS",
	});
	await service.archiveProject(
		A,
		project.id,
		true,
		project.revision,
		randomUUID(),
	);
	assert.equal(
		(await annotatedExport(G, project.id, file.id)).document.items.length,
		7,
	);
	assert.equal(
		(await annotatedExport(A, project.id, file.id)).document.items.length,
		7,
	);
	await service.revokeShare(A, project.id, share.id, randomUUID());
	await assert.rejects(annotatedExport(G, project.id, file.id), {
		code: "LINK_UNAVAILABLE",
	});
	results.push({
		check: "archived_reads_allowed_revoked_guest_rejected",
		status: "PASS",
	});
} finally {
	await mkdir("docs/evidence/p2-04a", { recursive: true });
	await writeFile(
		"docs/evidence/p2-04a/native.json",
		`${JSON.stringify({ environment: "disposable native PostgreSQL; synthetic Auth/file metadata only", results }, null, 2)}\n`,
	);
	await admin.end();
	await getPool().end();
}
console.log(JSON.stringify(results));
