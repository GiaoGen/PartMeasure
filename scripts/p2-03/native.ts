// Disposable native PostgreSQL only. No real Auth, Storage, browser or network acceptance.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import * as service from "../../src/lib/server/service";
import * as deliveries from "../../src/lib/server/delivery-service";
import * as feedback from "../../src/lib/server/delivery-feedback-service";
import { createFolder } from "../../src/lib/server/folder-service";
import { claimUpload, finalizeUpload } from "../../src/lib/server/complete-upload";
import { getPool, transaction, digest, type Actor } from "../../src/lib/server/db";
import { projectChanges } from "../../src/lib/server/project-changes";
import type { FileFilters } from "../../src/lib/archive-filters";
const url = new URL(process.env.DATABASE_URL ?? "");
if (process.env.PM_EVENTS_LOCAL !== "disposable-native-pg" || url.hostname !== "127.0.0.1" || url.port !== "55448") throw Error("LOCAL_ONLY");
const admin = new pg.Client({ host: url.hostname, port: 55448, user: "postgres", database: "postgres", ssl: { rejectUnauthorized: true, ca: await readFile(process.env.DATABASE_CA_FILE ?? "", "utf8") } });
const A = { kind: "owner" as const, id: randomUUID() }, B = { kind: "owner" as const, id: randomUUID() };
const results: { check: string; status: string; code?: string }[] = [];
async function check(name: string, work: () => Promise<void>) {
	if (process.env.PM_P203_ONLY && process.env.PM_P203_ONLY !== name) return;
	try { await work(); results.push({ check: name, status: "PASS" }); }
	catch (error) { const detail = (error as { message?: string }).message ?? ""; results.push({ check: name, status: "FAIL", code: /^[A-Z_]+$/.test(detail) ? detail : (error as { code?: string }).code ?? "ASSERTION_FAILED" }); process.exitCode = 1; }
	console.log(JSON.stringify(results.at(-1)));
}
let serial = 0;
await admin.connect();
try {
	await admin.query("insert into auth.users(id) values($1),($2)", [A.id, B.id]);
	const folder = await createFolder(A, { name: "archive-filter", description: "", color: "blue" }, randomUUID());
	assert.ok(folder);
	const project = await service.createProject(A, { name: "old-target", description: "find across pages", folderId: folder.id }, randomUUID());
	const share = await service.rotateShare(A, project.id, randomUUID());
	const raw = (share.url ?? "").split("/").at(-1) ?? "";
	const session = await service.bootstrap(raw);
	const G: Actor = { kind: "guest", hash: digest(session.secret) };
	for (let n = 0; n < 32; n++) await service.createProject(A, { name: `new-${n}`, description: "" }, randomUUID());
	async function file(ext: string, purpose: "material" | "delivery" = "material") {
		const filename = `part-${String(serial).padStart(3, "0")}.${ext}`;
		const mime = ext === "png" ? "image/png" : ext === "pdf" ? "application/pdf" : "application/octet-stream";
		const reservation = await service.reserve(A, project.id, { filename, byteSize: 8, declaredMime: mime, sha256: (++serial).toString(16).padStart(64, "0"), purpose }, randomUUID());
		// Fixture setup exceeds one production rate window; reset only this
		// synthetic actor's counter in the disposable local cluster.
		if (serial === 30) await admin.query("delete from pm.rate_limits where key=$1", [`complete:owner:${A.id}`]);
		const claim = await claimUpload(A, project.id, reservation.id);
		await finalizeUpload(A, claim.upload, { bytes: 8, hash: claim.upload.sha256, originalKey: `${project.id}/${reservation.id}/source`, key: `${project.id}/${reservation.id}/${ext === "png" ? "canonical.webp" : "source"}`, mime: ext === "png" ? "image/webp" : mime, width: ext === "png" ? 100 : null, height: ext === "png" ? 80 : null, normalizationVersion: ext === "png" ? 1 : null, thumbnails: [] });
		return reservation.id;
	}
	for (let n = 0; n < 36; n++) await file(["pdf", "step", "png", "zip"][n % 4] as string);
	const deliveryFile = await file("step", "delivery");
	const draft = await deliveries.saveDelivery(A, project.id, null, { description: "version", fileIds: [deliveryFile] }, null, randomUUID());
	const release = await deliveries.publishDelivery(A, project.id, draft.id, draft.revision, randomUUID());
	const received = await feedback.addFeedback(G, project.id, release.id, { kind: "received", body: "", guestLabel: "" }, randomUUID());
	assert.ok(received);
	await check("server_filters_find_projects_beyond_first_page", async () => {
		assert.ok(!(await service.listProjects(A, null)).items.some(item => item.id === project.id));
		const found = await service.listProjects(A, null, { q: "old-target", folderId: folder.id, status: "active" });
		assert.equal(found.items[0]?.id, project.id);
	});
	await check("file_types_and_all_sort_orders_have_complete_distinct_pages", async () => {
		for (const sort of ["created-desc", "created-asc", "name-asc"] as const) {
			const all: { id: string; filename: string }[] = []; let cursor: string | null = null;
			do { const page = await service.files(G, project.id, cursor, "material", { type: "all", sort }); all.push(...page.items); cursor = page.nextCursor; } while (cursor);
			assert.equal(all.length, 36); assert.equal(new Set(all.map(item => item.id)).size, 36);
			if (sort === "name-asc") assert.deepEqual(all.map(item => item.filename), all.map(item => item.filename).sort());
		}
		for (const type of ["pdf", "cad", "image", "zip"] as const) assert.equal((await service.files(G, project.id, null, "material", { type, sort: "created-desc" })).items.length, 9);
		const first = await service.files(G, project.id, null); assert.ok(first.nextCursor);
		await assert.rejects(service.files(G, project.id, first.nextCursor, "material", { type: "cad", sort: "name-asc" }), { code: "CURSOR_INVALID" });
	});
	const guestBefore = await service.projectDetail(G, project.id);
	const archived = await service.archiveProject(A, project.id, true, project.revision, randomUUID());
	await check("archive_preserves_reads_and_existing_shares_but_blocks_writes", async () => {
		assert.ok(archived.archivedAt, "ARCHIVE_STATUS_MISSING");
		assert.equal((await service.listProjects(A, null, { folderId: folder.id, q: "old-target", status: "active" })).items.length, 0, "ACTIVE_FILTER_INCLUDES_ARCHIVE");
		assert.equal((await service.listProjects(A, null, { folderId: folder.id, q: "old-target", status: "archived" })).items[0]?.id, project.id, "ARCHIVE_FILTER_MISSING");
		assert.equal((await service.files(G, project.id, null)).items.length, 30, "ARCHIVE_FILES_UNAVAILABLE");
		assert.equal((await deliveries.getDelivery(G, project.id, release.id)).id, release.id, "ARCHIVE_DELIVERY_UNAVAILABLE");
		await assert.rejects(service.reserve(G, project.id, { filename: "x.pdf", byteSize: 8, declaredMime: "application/pdf", sha256: "f".repeat(64) }, randomUUID()), { code: "PROJECT_ARCHIVED" });
		await assert.rejects(feedback.addFeedback(G, project.id, release.id, { kind: "withdrawn", body: "", guestLabel: "", targetId: received.id }, randomUUID()), { code: "PROJECT_ARCHIVED" });
		await assert.rejects(service.rotateShare(A, project.id, randomUUID()), { code: "PROJECT_ARCHIVED" });
		await service.bootstrap(raw);
		const events = await projectChanges(G, project.id, guestBefore.syncCursor);
		assert.ok(events.events.some(item => item.kind === "project.changed" && item.state === "archived"), "ARCHIVE_EVENT_MISSING");
	});
	await check("database_guards_and_owner_authority_are_enforced", async () => {
		await assert.rejects(transaction(A, db => db.query("insert into pm.deliveries(project_id,created_by) values($1,$2)", [project.id, A.id])), { code: "55000" });
		await assert.rejects(service.archiveProject(G, project.id, false, archived.revision, randomUUID()), { code: "FORBIDDEN" });
		await assert.rejects(service.archiveProject(B, project.id, false, archived.revision, randomUUID()), { code: "NOT_FOUND" });
	});
	await check("restore_preserves_files_and_does_not_revive_revoked_links", async () => {
		await service.revokeShare(A, project.id, share.id, randomUUID());
		await service.archiveProject(A, project.id, false, archived.revision, randomUUID());
		assert.equal((await service.listProjects(A, null, { folderId: folder.id, q: "old-target", status: "active" })).items[0]?.id, project.id);
		assert.equal((await service.files(A, project.id, null, "material", { type: "cad", sort: "name-asc" } satisfies FileFilters)).items.length, 9);
		await assert.rejects(service.files(G, project.id, null), { code: "LINK_UNAVAILABLE" });
		await assert.rejects(service.bootstrap(raw), { code: "LINK_UNAVAILABLE" });
	});
} finally {
	await admin.end(); await getPool().end();
	await mkdir("docs/evidence/p2-03", { recursive: true });
	await writeFile(`docs/evidence/p2-03/${process.env.PM_P203_ONLY ? "native-archive" : "native"}.json`, `${JSON.stringify({ checkedAt: new Date().toISOString(), scope: "Disposable local PG SQL/RLS/DAL only; synthetic identities and file metadata. Not real Supabase Auth/Storage, downloads, mobile/network or UI acceptance.", results }, null, 2)}\n`);
}
