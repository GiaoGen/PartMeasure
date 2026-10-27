// Disposable native PostgreSQL + synthetic Auth/Storage metadata. Never Supabase/cloud writes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import * as service from "../../src/lib/server/service";
import * as deliveries from "../../src/lib/server/delivery-service";
import { claimUpload, finalizeUpload } from "../../src/lib/server/complete-upload";
import { digest, getPool, type Actor } from "../../src/lib/server/db";
const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.PM_EVENTS_LOCAL !== "disposable-native-pg" || url.hostname !== "127.0.0.1" || url.port !== "55448") throw Error("LOCAL_ONLY");
const admin = new pg.Client({ host: url.hostname, port: 55448, user: "postgres", database: "postgres", ssl: { rejectUnauthorized: true, ca: await readFile(process.env.DATABASE_CA_FILE ?? "", "utf8") } });
const A = { kind: "owner" as const, id: randomUUID() }, B = { kind: "owner" as const, id: randomUUID() };
const results: object[] = [];
let serial = 0;
async function check(name: string, work: () => Promise<void>) {
	try { await work(); results.push({ name, status: "PASS" }); }
	catch { results.push({ name, status: "FAIL", code: "BOUNDARY_ASSERTION_FAILED" }); process.exitCode = 1; }
	console.log(JSON.stringify(results.at(-1)));
}
await admin.connect();
try {
	await admin.query("insert into auth.users(id) values($1),($2)", [A.id, B.id]);
	const project = await service.createProject(A, { name: "FIX-B metadata", description: "local fixture only" }, randomUUID());
	const other = await service.createProject(A, { name: "other context", description: "" }, randomUUID());
	const share = await service.rotateShare(A, project.id, randomUUID());
	const session = await service.bootstrap(new URL(share.url ?? "http://invalid").pathname.split("/").at(-1) ?? "");
	const G: Actor = { kind: "guest", hash: digest(session.secret) };
	async function file(ext: string, purpose: "material" | "delivery" = "material") {
		const filename = `中文资料-${serial++}.${ext}`, mime = ext === "png" ? "image/png" : ext === "pdf" ? "application/pdf" : "application/octet-stream";
		const reservation = await service.reserve(A, project.id, { filename, byteSize: 8, declaredMime: mime, sha256: serial.toString(16).padStart(64, "0"), purpose }, randomUUID());
		if (serial % 25 === 0) await admin.query("delete from pm.rate_limits where key=$1", [`complete:owner:${A.id}`]); // Only this new local fixture actor.
		const claim = await claimUpload(A, project.id, reservation.id);
		await finalizeUpload(A, claim.upload, { bytes: 8, hash: claim.upload.sha256, originalKey: `${project.id}/${reservation.id}/source`, key: `${project.id}/${reservation.id}/${ext === "png" ? "canonical.webp" : "source"}`, mime: ext === "png" ? "image/webp" : mime, width: ext === "png" ? 100 : null, height: ext === "png" ? 80 : null, normalizationVersion: ext === "png" ? 1 : null, thumbnails: [] });
		return { id: reservation.id, filename };
	}
	const photo = await file("png"), pdf = await file("pdf");
	for (let n = 0; n < 31; n++) await file("step");
	await check("photo_and_attachment_outside_first_page_and_filter_have_exact_identity", async () => {
		assert.ok(!(await service.files(A, project.id, null)).items.some(item => [photo.id, pdf.id].includes(item.id)));
		assert.ok(!(await service.files(A, project.id, null, "material", { type: "cad", sort: "name-asc" })).items.some(item => item.id === pdf.id));
		for (const target of [photo, pdf]) for (const actor of [A, G]) {
			const data = await service.fileMetadata(actor, project.id, target.id);
			assert.equal(data.filename, target.filename); assert.equal(data.byteSize, 8);
			assert.deepEqual(Object.keys(data).sort(), ["id", "filename", "mime", "extension", "byteSize", "uploaderType", "createdAt"].sort());
		}
	});
	await check("other_owner_wrong_project_unknown_and_hidden_metadata_are_denied", async () => {
		await assert.rejects(service.fileMetadata(B, project.id, photo.id), { code: "NOT_FOUND" });
		await assert.rejects(service.fileMetadata(A, other.id, photo.id), { code: "NOT_FOUND" });
		await assert.rejects(service.fileMetadata(A, project.id, randomUUID()), { code: "NOT_FOUND" });
		await service.deleteFile(A, project.id, pdf.id, randomUUID());
		for (const actor of [A, G]) await assert.rejects(service.fileMetadata(actor, project.id, pdf.id), { code: "NOT_FOUND" });
	});
	const privateFile = await file("step", "delivery"), publishedFile = await file("step", "delivery");
	await check("guest_private_draft_denied_and_published_attachment_visible", async () => {
		assert.equal((await service.fileMetadata(A, project.id, privateFile.id)).id, privateFile.id);
		for (const target of [privateFile, publishedFile]) await assert.rejects(service.fileMetadata(G, project.id, target.id), { code: "NOT_FOUND" });
		const draft = await deliveries.saveDelivery(A, project.id, null, { description: "fixed version", fileIds: [publishedFile.id] }, null, randomUUID());
		await deliveries.publishDelivery(A, project.id, draft.id, draft.revision, randomUUID());
		assert.equal((await service.fileMetadata(G, project.id, publishedFile.id)).filename, publishedFile.filename);
		await assert.rejects(service.fileMetadata(G, project.id, privateFile.id), { code: "NOT_FOUND" });
	});
	await check("archive_keeps_metadata_readable_and_revoked_session_cannot_reuse_it", async () => {
		await service.archiveProject(A, project.id, true, project.revision, randomUUID());
		assert.equal((await service.fileMetadata(G, project.id, photo.id)).id, photo.id);
		await service.revokeShare(A, project.id, share.id, randomUUID());
		await assert.rejects(service.fileMetadata(G, project.id, photo.id), { code: "LINK_UNAVAILABLE" });
	});
} finally {
	await admin.end(); await getPool().end();
	await mkdir("docs/evidence/fix-b", { recursive: true });
	await writeFile("docs/evidence/fix-b/native-metadata.json", `${JSON.stringify({ checkedAt: new Date().toISOString(), scope: "Strict TLS disposable native PG, formal migrations and actual restricted runtime DAL/RLS. Synthetic identities and metadata only; not Supabase Auth/Storage or browser/phone acceptance.", results }, null, 2)}\n`);
}
