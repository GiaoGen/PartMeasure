// Disposable PostgreSQL only; synthetic identities and file metadata, never cloud.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import * as service from "../../src/lib/server/service";
import * as annotations from "../../src/lib/server/annotation-service";
import * as issues from "../../src/lib/server/issue-service";
import * as deliveries from "../../src/lib/server/delivery-service";
import {
	zipSnapshot,
	zipAccess,
} from "../../src/lib/server/zip-package-service";
import { pdfReport } from "../../src/lib/server/pdf-report-service";
import {
	claimUpload,
	finalizeUpload,
} from "../../src/lib/server/complete-upload";
import {
	digest,
	getPool,
	transaction,
	type Actor,
} from "../../src/lib/server/db";
import { emptyMetadata } from "../../src/lib/annotations";
import type { ZipSelection } from "../../src/lib/zip-package";
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
		{ name: "ZIP合成资料", description: "" },
		randomUUID(),
	);
	const share = await service.rotateShare(A, project.id, randomUUID());
	const session = await service.bootstrap(
		(share.url ?? "").split("/").at(-1) ?? "",
	);
	const G: Actor = { kind: "guest", hash: digest(session.secret) };
	let serial = 0;
	async function file(
		ext: "png" | "step",
		purpose: "material" | "delivery" = "material",
	) {
		const hash = (++serial).toString(16).padStart(64, "0"),
			reservation = await service.reserve(
				A,
				project.id,
				{
					filename: `同名.${ext}`,
					byteSize: 8,
					declaredMime:
						ext === "png" ? "image/png" : "application/octet-stream",
					sha256: hash,
					purpose,
				},
				randomUUID(),
			);
		const claim = await claimUpload(A, project.id, reservation.id);
		await finalizeUpload(A, claim.upload, {
			bytes: 8,
			hash: ext === "png" ? "a".repeat(64) : hash,
			originalKey: `${project.id}/${reservation.id}/source`,
			key: `${project.id}/${reservation.id}/${ext === "png" ? "canonical.webp" : "source"}`,
			mime: ext === "png" ? "image/webp" : "application/octet-stream",
			width: ext === "png" ? 800 : null,
			height: ext === "png" ? 600 : null,
			normalizationVersion: ext === "png" ? 1 : null,
			thumbnails: [],
		});
		return {
			id: reservation.id,
			sourceHash: hash,
			hash: ext === "png" ? "a".repeat(64) : hash,
		};
	}
	const photo = await file("png"),
		cad = await file("step"),
		delivered = await file("step", "delivery"),
		otherAttachment = await file("step", "delivery");
	const draft = await deliveries.saveDelivery(
		A,
		project.id,
		null,
		{ description: "所选发布版", fileIds: [delivered.id] },
		null,
		randomUUID(),
	);
	const published = await deliveries.publishDelivery(
		A,
		project.id,
		draft.id,
		draft.revision,
		randomUUID(),
	);
	const privateDraft = await deliveries.saveDelivery(
		A,
		project.id,
		null,
		{ description: "不可打包的私有草稿", fileIds: [otherAttachment.id] },
		null,
		randomUUID(),
	);
	const geometry = {
			type: "line" as const,
			from: { x: 0.1, y: 0.1 },
			to: { x: 0.8, y: 0.1 },
		},
		metadata = emptyMetadata();
	const item = await annotations.createAnnotation(
		A,
		project.id,
		{
			id: randomUUID(),
			fileId: photo.id,
			imageHash: photo.hash,
			geometry,
			metadata,
		},
		randomUUID(),
	);
	const list = await issues.listIssues(G, project.id, null, photo.id, null),
		issue = list.items[0];
	assert.ok(issue);
	await issues.respondIssue(
		G,
		project.id,
		issue.id,
		{
			kind: "numeric",
			value: "12.5",
			unit: "mm",
			body: "旧位置读数",
			evidenceFileIds: [],
			guestLabel: "",
		},
		issue.revision,
		randomUUID(),
	);
	const changed = { ...geometry, to: { x: 0.7, y: 0.2 } };
	await annotations.changeAnnotation(
		A,
		project.id,
		item.id,
		{ imageHash: photo.hash, geometry: changed, metadata },
		1,
		randomUUID(),
	);
	const selection: ZipSelection = {
		materialIds: [cad.id, photo.id],
		originals: false,
		delivery: { id: published.id, fileIds: [delivered.id] },
	};
	const guest = await zipSnapshot(G, project.id, selection);
	assert.deepEqual(
		guest.files.map((file) => file.variant),
		["material", "standard", "delivery"],
	);
	assert.ok(
		guest.data.history.some(
			(entry) =>
				entry.kind === "response" &&
				"value" in entry.record &&
				entry.record.value === "12.5",
		),
	);
	const old = guest.data.fixedAnnotations.find(
		(fixed) => fixed.annotationId === item.id && fixed.revision === 1,
	);
	assert.ok(old);
	assert.deepEqual(old.annotation.geometry, geometry);
	assert.deepEqual(guest.data.photos[0]?.document.items[0]?.geometry, changed);
	assert.equal(
		guest.data.photos[0]?.document.items[0]?.collaboration?.values?.dimension,
		undefined,
	);
	assert.deepEqual(guest.data.delivery?.selectedFileIds, [delivered.id]);
	assert.ok(!JSON.stringify(guest).includes("storage_key"));
	const hiddenRevisions = await transaction(G, (db) =>
		db.query(
			"select revision from pm.annotation_revisions where project_id=$1 and annotation_id=$2",
			[project.id, item.id],
		),
	);
	assert.equal(hiddenRevisions.rows.length, 0);
	results.push({
		check:
			"guest_mixed_selection_fixed_issue_snapshots_without_private_revision_access",
		status: "PASS",
	});
	const owner = await zipSnapshot(A, project.id, {
		...selection,
		originals: true,
	});
	assert.equal(
		owner.files.find((file) => file.variant === "original")?.sha256,
		photo.sourceHash,
	);
	assert.equal(
		owner.files.find((file) => file.variant === "standard")?.sha256,
		photo.hash,
	);
	await assert.rejects(
		zipSnapshot(G, project.id, { ...selection, originals: true }),
		{ code: "FORBIDDEN" },
	);
	await assert.rejects(zipSnapshot(B, project.id, selection), {
		code: "NOT_FOUND",
	});
	await assert.rejects(
		zipSnapshot(A, project.id, {
			...selection,
			delivery: { id: privateDraft.id, fileIds: [otherAttachment.id] },
		}),
		{ code: "NOT_FOUND" },
	);
	await assert.rejects(
		zipSnapshot(A, project.id, {
			...selection,
			delivery: { id: published.id, fileIds: [otherAttachment.id] },
		}),
		{ code: "NOT_FOUND" },
	);
	await assert.rejects(
		zipSnapshot(G, project.id, { ...selection, materialIds: [randomUUID()] }),
		{ code: "NOT_FOUND" },
	);
	results.push({
		check:
			"owner_original_hash_guest_original_cross_owner_draft_membership_rejected",
		status: "PASS",
	});
	await annotations.changeAnnotation(
		A,
		project.id,
		item.id,
		{
			imageHash: photo.hash,
			geometry: changed,
			metadata: { ...metadata, dimension: "15" },
		},
		2,
		randomUUID(),
	);
	assert.equal(guest.data.photos[0]?.document.items[0]?.revision, 2);
	assert.equal((await zipAccess(G, project.id, selection)).files.length, 3);
	assert.ok(
		(await pdfReport(G, project.id, [photo.id])).history.some(
			(entry) => entry.kind === "response",
		),
	);
	await service.archiveProject(
		A,
		project.id,
		true,
		project.revision,
		randomUUID(),
	);
	assert.equal((await zipSnapshot(G, project.id, selection)).files.length, 3);
	await service.revokeShare(A, project.id, share.id, randomUUID());
	await assert.rejects(zipAccess(G, project.id, selection), {
		code: "LINK_UNAVAILABLE",
	});
	results.push({
		check:
			"frozen_revision_final_access_archive_revocation_and_shared_pdf_history",
		status: "PASS",
	});
} finally {
	await mkdir("docs/evidence/p2-05", { recursive: true });
	await writeFile(
		"docs/evidence/p2-05/native.json",
		`${JSON.stringify({ environment: "disposable PostgreSQL; synthetic Auth/file metadata only", results }, null, 2)}\n`,
	);
	await admin.end();
	await getPool().end();
}
console.log(JSON.stringify(results));
