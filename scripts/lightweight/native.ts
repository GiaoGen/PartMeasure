// Real SQL transaction/RLS checks in disposable local PG. No cloud Auth/Storage substitutes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import * as service from "../../src/lib/server/service";
import { claimUpload, finalizeUpload } from "../../src/lib/server/complete-upload";
import { type Actor, getPool, transaction, digest } from "../../src/lib/server/db";
const url = new URL(process.env.DATABASE_URL ?? "");
if (process.env.PM_EVENTS_LOCAL !== "disposable-native-pg" || url.hostname !== "127.0.0.1" || url.port !== "55448") throw Error("LOCAL_ONLY");
const admin = new pg.Client({ host: "127.0.0.1", port: 55448, user: "postgres", database: "postgres", ssl: { rejectUnauthorized: true, ca: await readFile(process.env.DATABASE_CA_FILE ?? "", "utf8") } });
const A: Actor = { kind: "owner", id: randomUUID() }, B: Actor = { kind: "owner", id: randomUUID() };
const results: { check: string; status: string; code?: string }[] = [];
async function check(check: string, work: () => Promise<void>) {
	try { await work(); results.push({ check, status: "PASS" }); }
	catch (e) { results.push({ check, status: "FAIL", code: (e as { code?: string }).code ?? "ASSERTION_FAILED" }); }
	console.log(JSON.stringify(results.at(-1)));
}
const rejects = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: {code?: string}) => e.code === code);
await admin.connect();
let seq = 0;
try {
	await admin.query("insert into auth.users(id) values($1),($2)", [A.id, B.id]);
	const p = await service.createProject(A, { name: "lightweight synthetic", description: "" }, randomUUID());
	const share = await service.rotateShare(A, p.id, randomUUID());
	const session = await service.bootstrap((share.url ?? "").split("/").at(-1) ?? "");
	const G: Actor = { kind: "guest", hash: digest(session.secret) };
	async function reserve(actor: Actor = A, purpose: "material" | "delivery" = "material") {
		return service.reserve(actor, p.id, { filename: "example.pdf", byteSize: 8, declaredMime: "application/pdf", sha256: (++seq).toString(16).padStart(64, "0"), purpose }, randomUUID());
	}
	const data = (r: Awaited<ReturnType<typeof claimUpload>>) => ({ bytes: 8, hash: r.upload.sha256, originalKey: `${p.id}/${r.upload.id}/source`, key: `${p.id}/${r.upload.id}/source`, mime: "application/pdf", width: null, height: null, normalizationVersion: null, thumbnails: [] });
	await check("runtime-claim-finalize-idempotency-quota-and-no-job-enqueued", async () => {
		const r = await reserve(); const c = await claimUpload(A, p.id, r.id);
		await finalizeUpload(A, c.upload, data(c));
		assert.equal((await claimUpload(A, p.id, r.id)).ready, true);
		assert.equal((await admin.query("select count(*)::int as n from pm.jobs")).rows[0].n, 0);
		const totals = (await admin.query("select used_bytes,reserved_bytes from pm.owner_usage where owner_id=$1", [A.id])).rows[0];
		assert.equal(Number(totals.used_bytes), 8); assert.equal(Number(totals.reserved_bytes), 0);
		assert.equal((await admin.query("select validation_policy from pm.file_assets where id=$1", [r.id])).rows[0].validation_policy, "format-only-v2");
		await rejects(transaction(A, db => db.query("update pm.file_assets set validation_policy='clamav-v1' where id=$1", [r.id])), "23514");
	});
	await check("Guest-finalize-and-role-isolation-with-project-edit-still-denied", async () => {
		const r = await reserve(G); await rejects(claimUpload(B, p.id, r.id), "NOT_FOUND");
		await rejects(claimUpload(A, p.id, r.id), "NOT_FOUND");
		const c = await claimUpload(G, p.id, r.id); await finalizeUpload(G, c.upload, data(c));
		assert.equal((await service.files(G, p.id, null)).items.length, 2);
		await rejects(transaction(G, db => db.query("update pm.projects set name='forged' where id=$1", [p.id])), "42501");
		await rejects(reserve(G, "delivery"), "FORBIDDEN");
	});
	await check("active-claim-expiry-takeover-and-late-finalize-fence", async () => {
		const r = await reserve(); const old = await claimUpload(A, p.id, r.id);
		await rejects(claimUpload(A, p.id, r.id), "PROCESSING_ACTIVE");
		await admin.query("update pm.upload_reservations set processing_until=now()-interval '1 second' where id=$1", [r.id]);
		const next = await claimUpload(A, p.id, r.id);
		await rejects(finalizeUpload(A, old.upload, data(old)), "PROCESSING_EXPIRED");
		await finalizeUpload(A, next.upload, data(next));
	});
	await check("legacy-queued-upload-takeover-with-history-retained", async () => {
		const r = await reserve();
		await admin.query("update pm.upload_reservations set state='queued' where id=$1", [r.id]);
		await admin.query("insert into pm.jobs(reservation_id) values($1)", [r.id]);
		const c = await claimUpload(A, p.id, r.id); await finalizeUpload(A, c.upload, data(c));
		assert.ok((await admin.query("select done_at from pm.jobs where reservation_id=$1", [r.id])).rows[0].done_at);
	});
	await check("delivery-remains-private-until-atomic-publication", async () => {
		const r = await reserve(A, "delivery"); const c = await claimUpload(A, p.id, r.id); await finalizeUpload(A, c.upload, data(c));
		await rejects(service.fileForRead(G, p.id, r.id), "NOT_FOUND");
	});
	await check("runtime-image-derivatives-and-insert-fence", async () => {
		const r = await service.reserve(G, p.id, { filename: "image.png", byteSize: 8, declaredMime: "image/png", sha256: (++seq).toString(16).padStart(64, "0") }, randomUUID());
		const c = await claimUpload(G, p.id, r.id);
		await rejects(transaction(G, db => db.query(`insert into pm.file_assets(id,project_id,reservation_id,filename,mime,extension,byte_size,original_bytes,storage_key,original_key,sha256,original_sha256,uploader_type,validation_policy) values($1,$2,$1,'image.png','image/webp','png',8,8,$3,$4,$5,$5,'guest','format-only-v2')`, [r.id, p.id, `${p.id}/${r.id}/canonical.webp`, `${p.id}/${r.id}/source`, c.upload.sha256])), "42501");
		await finalizeUpload(G, c.upload, { ...data(c), key: `${p.id}/${r.id}/canonical.webp`, mime: "image/webp", width: 1000, height: 800, normalizationVersion: 1,
			thumbnails: [320, 640].map(variant => ({ variant, width: variant, height: variant * 0.8, bytes: 80, hash: c.upload.sha256, key: `${p.id}/${r.id}/thumb-${variant}.webp` })) });
		assert.equal((await service.fileForRead(G, p.id, r.id, false, 320)).byte_size, "80");
	});
	await check("revocation-during-processing-rejects-finalize-and-preserves-quota", async () => {
		const r = await reserve(G); const c = await claimUpload(G, p.id, r.id);
		await service.revokeShare(A, p.id, share.id, randomUUID());
		await rejects(finalizeUpload(G, c.upload, data(c)), "LINK_UNAVAILABLE");
		assert.equal((await admin.query("select count(*)::int as n from pm.file_assets where id=$1", [r.id])).rows[0].n, 0);
	});
} finally {
	await admin.end(); await getPool().end();
	await mkdir("docs/evidence/lightweight", { recursive: true });
	await writeFile("docs/evidence/lightweight/native.json", `${JSON.stringify({ checkedAt: new Date().toISOString(), scope: "Disposable native PG: RLS/transactions only, no cloud Auth/Storage", results }, null, 2)}\n`);
}
if (results.some(r => r.status !== "PASS")) process.exitCode = 1;
