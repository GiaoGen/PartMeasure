// Disposable PostgreSQL only; synthetic identities/file metadata, no real Auth/Storage.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import * as service from "../../src/lib/server/service";
import * as annotations from "../../src/lib/server/annotation-service";
import * as issues from "../../src/lib/server/issue-service";
import { pdfReport } from "../../src/lib/server/pdf-report-service";
import { annotatedExport } from "../../src/lib/server/annotated-export-service";
import {
	claimUpload,
	finalizeUpload,
} from "../../src/lib/server/complete-upload";
import { digest, getPool, type Actor } from "../../src/lib/server/db";
import { emptyMetadata } from "../../src/lib/annotations";
import { pdfPhotoBlocks } from "../../src/lib/pdf-report";
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
		{ name: "PDF合成资料", description: "" },
		randomUUID(),
	);
	const share = await service.rotateShare(A, project.id, randomUUID());
	const session = await service.bootstrap(
		(share.url ?? "").split("/").at(-1) ?? "",
	);
	const G: Actor = { kind: "guest", hash: digest(session.secret) };
	const files: { id: string; hash: string }[] = [];
	for (let n = 1; n <= 2; n++) {
		const hash = String(n).repeat(64),
			reservation = await service.reserve(
				A,
				project.id,
				{
					filename: `照片${n}.png`,
					byteSize: 8,
					declaredMime: "image/png",
					sha256: hash,
					purpose: "material",
				},
				randomUUID(),
			);
		const claim = await claimUpload(A, project.id, reservation.id);
		await finalizeUpload(A, claim.upload, {
			bytes: 8,
			hash,
			originalKey: `${project.id}/${reservation.id}/source`,
			key: `${project.id}/${reservation.id}/canonical.webp`,
			mime: "image/webp",
			width: 800,
			height: 600,
			normalizationVersion: 1,
			thumbnails: [],
		});
		files.push({ id: reservation.id, hash });
	}
	const first = files[0],
		second = files[1];
	if (!first || !second) throw Error("FIXTURE");
	const item = await annotations.createAnnotation(
		A,
		project.id,
		{
			id: randomUUID(),
			fileId: first.id,
			imageHash: first.hash,
			geometry: {
				type: "line",
				from: { x: 0.1, y: 0.1 },
				to: { x: 0.8, y: 0.1 },
			},
			metadata: emptyMetadata(),
		},
		randomUUID(),
	);
	const list = await issues.listIssues(G, project.id, null, first.id, null),
		issue = list.items[0];
	assert.ok(issue);
	const numeric = await issues.respondIssue(
		G,
		project.id,
		issue.id,
		{
			kind: "numeric",
			value: "12.5",
			unit: "mm",
			body: "原始读数",
			evidenceFileIds: [],
			guestLabel: "",
		},
		issue.revision,
		randomUUID(),
	);
	assert.ok(numeric.response);
	const remeasure = await issues.reviewIssue(
		A,
		project.id,
		issue.id,
		{
			decision: "remeasure",
			responseId: numeric.response.id,
			value: null,
			unit: null,
			source: null,
			note: "避开倒角补测",
		},
		numeric.revision,
		randomUUID(),
	);
	await issues.respondIssue(
		G,
		project.id,
		issue.id,
		{
			kind: "unable",
			body: "现有工具无法测量",
			evidenceFileIds: [],
			guestLabel: "",
		},
		remeasure.revision,
		randomUUID(),
	);
	await annotations.changeAnnotation(
		A,
		project.id,
		item.id,
		{
			imageHash: first.hash,
			geometry: item.geometry,
			metadata: { ...item.metadata, dimension: "13" },
		},
		item.revision,
		randomUUID(),
	);
	const report = await pdfReport(G, project.id, [second.id, first.id]);
	assert.deepEqual(
		report.photos.map((photo) => photo.file.id),
		[second.id, first.id],
	);
	assert.ok(
		report.photos.every((photo) => photo.capturedAt === report.capturedAt),
	);
	assert.deepEqual(
		report.history.map((entry) => entry.kind),
		["response", "review", "response", "closure"],
	);
	const photo = report.photos[1];
	assert.ok(photo);
	const text = pdfPhotoBlocks(report, photo)
		.flatMap((block) => block.lines)
		.join("\n");
	assert.match(text, /13 mm（工程师人工）/);
	assert.match(text, /12.5 mm（人工回复数值）/);
	assert.match(text, /无法测量，无数值/);
	assert.match(text, /避开倒角补测/);
	assert.ok(report.history.every((entry) => entry.annotationRevision === 1));
	assert.ok(!JSON.stringify(report).includes("storage_key"));
	results.push({
		check: "batch_selection_order_fixed_capture_and_full_related_history",
		status: "PASS",
	});
	const old = await annotatedExport(A, project.id, first.id);
	assert.equal(old.document.items[0]?.metadata.dimension, "13");
	await annotations.changeAnnotation(
		A,
		project.id,
		item.id,
		{
			imageHash: first.hash,
			geometry: item.geometry,
			metadata: { ...item.metadata, dimension: "14" },
		},
		2,
		randomUUID(),
	);
	assert.equal(report.photos[1]?.document.items[0]?.metadata.dimension, "13");
	assert.equal(
		(await annotatedExport(A, project.id, first.id)).document.items[0]?.metadata
			.dimension,
		"14",
	);
	results.push({
		check: "single_image_contract_preserved_no_later_revision_mixed",
		status: "PASS",
	});
	await assert.rejects(pdfReport(B, project.id, [first.id]), {
		code: "NOT_FOUND",
	});
	await assert.rejects(pdfReport(A, project.id, [first.id, first.id]), {
		code: "INVALID_INPUT",
	});
	await assert.rejects(pdfReport(G, project.id, [first.id, randomUUID()]), {
		code: "NOT_FOUND",
	});
	await service.archiveProject(
		A,
		project.id,
		true,
		project.revision,
		randomUUID(),
	);
	assert.equal(
		(await pdfReport(G, project.id, [first.id, second.id])).photos.length,
		2,
	);
	await service.revokeShare(A, project.id, share.id, randomUUID());
	await assert.rejects(pdfReport(G, project.id, [first.id]), {
		code: "LINK_UNAVAILABLE",
	});
	results.push({
		check: "rls_cross_owner_missing_file_duplicate_archive_and_revocation",
		status: "PASS",
	});
} finally {
	await mkdir("docs/evidence/p2-04b", { recursive: true });
	await writeFile(
		"docs/evidence/p2-04b/native.json",
		`${JSON.stringify({ environment: "disposable PostgreSQL; synthetic Auth/file metadata only", results }, null, 2)}\n`,
	);
	await admin.end();
	await getPool().end();
}
console.log(JSON.stringify(results));
