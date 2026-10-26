// One bounded DB + real private-byte recovery in a fresh native PostgreSQL cluster.
// Auth/Storage services are NOT being simulated as cloud acceptance.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir, mkdtemp, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";
import { createBackup, databaseClient } from "../maintenance/backup";
import { restoreBackup } from "../maintenance/restore";
import * as service from "../../src/lib/server/service";
import { getPool, digest } from "../../src/lib/server/db";
import { claimUpload, finalizeUpload } from "../../src/lib/server/complete-upload";
import { createAnnotation, changeAnnotation } from "../../src/lib/server/annotation-service";
import { listIssues, respondIssue } from "../../src/lib/server/issue-service";
import { saveDelivery, publishDelivery } from "../../src/lib/server/delivery-service";
import { addFeedback } from "../../src/lib/server/delivery-feedback-service";
import { emptyMetadata } from "../../src/lib/annotations";

const runtimeUrl = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.PM_EVENTS_LOCAL !== "disposable-native-pg" || runtimeUrl.hostname !== "127.0.0.1" || runtimeUrl.port !== "55448") throw Error("LOCAL_ONLY");
const caFile = process.env.DATABASE_CA_FILE ?? "", ca = await readFile(caFile, "utf8");
const sourceUrl = new URL("postgresql://postgres@127.0.0.1:55448/postgres");
const admin = databaseClient(sourceUrl, ca);
const runRoot = await mkdtemp(path.resolve("tmp/p3-04-"));
const privateRoot = path.join(runRoot, "source-private"); await mkdir(privateRoot);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const key = randomBytes(32), signal = AbortSignal.timeout(180000);
const checks: string[] = [];
let stage = "seed", connected = false;
const A = { kind: "owner" as const, id: randomUUID() }, B = { kind: "owner" as const, id: randomUUID() };
try {
	await admin.connect(); connected = true;
	await admin.query("insert into auth.users(id) values($1),($2)", [A.id, B.id]);
	const project = await service.createProject(A, { name: "P3-04 synthetic recovery", description: "fixture only" }, randomUUID());
	await service.rotateShare(A, project.id, randomUUID()); // already-revoked history remains in backup
	const share = await service.rotateShare(A, project.id, randomUUID());
	const session = await service.bootstrap((share.url ?? "").split("/").at(-1) ?? "");
	const G = { kind: "guest" as const, hash: digest(session.secret) };
	async function file(filename: string, bytes: Buffer, purpose: "material" | "delivery", image = false) {
		const reserved = await service.reserve(A, project.id, { filename, byteSize: bytes.length, declaredMime: image ? "image/png" : "application/octet-stream", sha256: hash(bytes), purpose }, randomUUID());
		const claim = await claimUpload(A, project.id, reserved.id);
		const originalKey = `${project.id}/${reserved.id}/source`;
		const key = image ? `${project.id}/${reserved.id}/canonical.webp` : originalKey;
		const canonical = image ? await sharp(bytes).webp().toBuffer() : bytes;
		await mkdir(path.join(privateRoot, project.id, reserved.id), { recursive: true });
		await writeFile(path.join(privateRoot, originalKey), bytes);
		if (image) await writeFile(path.join(privateRoot, key), canonical);
		await finalizeUpload(A, claim.upload, { originalKey, key, mime: image ? "image/webp" : "application/octet-stream", bytes: canonical.length, hash: hash(canonical), width: image ? 100 : null, height: image ? 80 : null, normalizationVersion: image ? 1 : null, thumbnails: [] });
		return { id: reserved.id, hash: hash(canonical) };
	}
	const photo = await file("fixture.png", await sharp({ create: { width: 100, height: 80, channels: 3, background: "#335577" } }).png().toBuffer(), "material", true);
	const oldFile = await file("v1.step", Buffer.from("ISO-10303-21;\nP3-04 V1"), "delivery");
	const newFile = await file("v2.step", Buffer.from("ISO-10303-21;\nP3-04 V2"), "delivery");
	const secretFile = await file("draft.step", Buffer.from("ISO-10303-21;\nPRIVATE DRAFT"), "delivery");
	const geometry = { type: "line" as const, from: { x: 0.2, y: 0.2 }, to: { x: 0.8, y: 0.2 } };
	const annotation = await createAnnotation(A, project.id, { id: randomUUID(), fileId: photo.id, imageHash: photo.hash, geometry, metadata: emptyMetadata() }, randomUUID());
	const issue = (await listIssues(G, project.id, null)).items[0]; assert.ok(issue);
	await respondIssue(G, project.id, issue.id, { kind: "numeric", value: "12", unit: "mm", body: "synthetic", evidenceFileIds: [], guestLabel: "fixture" }, issue.revision, randomUUID());
	await changeAnnotation(A, project.id, annotation.id, { imageHash: photo.hash, geometry: { ...geometry, to: { x: 0.8, y: 0.3 } }, metadata: emptyMetadata() }, annotation.revision, randomUUID());
	const first = await saveDelivery(A, project.id, null, { description: "first", fileIds: [oldFile.id] }, null, randomUUID());
	const release = await publishDelivery(A, project.id, first.id, first.revision, randomUUID());
	const second = await saveDelivery(A, project.id, null, { description: "second", fileIds: [newFile.id] }, null, randomUUID());
	await publishDelivery(A, project.id, second.id, second.revision, randomUUID());
	await saveDelivery(A, project.id, null, { description: "private", fileIds: [secretFile.id] }, null, randomUUID());
	await addFeedback(G, project.id, release.id, { kind: "accepted", body: "", guestLabel: "fixture" }, randomUUID());
	await service.archiveProject(A, project.id, true, project.revision, randomUUID());
	checks.push("synthetic fixed replies/revisions, two immutable versions, private draft and archive seeded through current DAL");
	stage = "encrypted_backup";
	const postgresBin = "C:/Program Files/PostgreSQL/18/bin";
	const started = performance.now();
	const backup = await createBackup({ sourceUrl, caFile, postgresBin, directory: path.join(runRoot, "backup"), key, native: true, signal, readObject: async name => createReadStream(path.join(privateRoot, name)) });
	assert.equal(backup.objects.length, 5);
	checks.push("one PostgreSQL snapshot; encrypted schema/data plus five exact private byte objects and migration sources");
	const targetName = `pm_restore_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
	await admin.query(`create database "${targetName}"`);
	await admin.query(`comment on database "${targetName}" is 'partmeasure:disposable-restore:v1'`);
	const targetUrl = new URL(sourceUrl); targetUrl.pathname = `/${targetName}`;
	const options = { directory: path.join(runRoot, "backup"), targetUrl, caFile, postgresBin, key, signal };
	stage = "authenticate_without_writes";
	await restoreBackup({ ...options, workspace: path.join(runRoot, "inspect"), apply: false });
	checks.push("default authentication-only run writes no database or recovered object set");
	stage = "restore"; const restoreStarted = performance.now();
	await restoreBackup({ ...options, workspace: path.join(runRoot, "restore"), apply: true });
	const restoreMs = Math.round(performance.now() - restoreStarted);
	checks.push("fresh marked local database restored atomically and all pm table row hashes matched before access invalidation");
	for (const object of backup.objects) assert.equal(hash(await readFile(path.join(runRoot, "restore/private-objects", object.key))), object.sha256);
	for (const migration of backup.migrations) assert.equal(hash(await readFile(path.join(runRoot, "restore/migrations", migration.migration))), migration.sha256);
	checks.push("all restored private files match expected byte size and SHA-256 at their original references");
	const restricted = new pg.Client({ host: "127.0.0.1", port: 55448, user: "partmeasure_runtime", database: targetName, ssl: { rejectUnauthorized: true, ca } });
	await restricted.connect();
	try {
		await restricted.query("begin");
		await restricted.query("select set_config('pm.owner_id',$1,true)", [A.id]);
		assert.equal((await restricted.query("select count(*)::int n from pm.deliveries where project_id=$1 and state='published'", [project.id])).rows[0].n, 2);
		assert.equal((await restricted.query("select count(*)::int n from pm.deliveries where project_id=$1 and state='draft'", [project.id])).rows[0].n, 1);
		assert.equal((await restricted.query("select count(*)::int n from pm.issue_responses where project_id=$1 and value='12'", [project.id])).rows[0].n, 1);
		assert.equal((await restricted.query("select annotation_revision as r from pm.issues where id=$1", [issue.id])).rows[0].r, 1);
		await restricted.query("select set_config('pm.owner_id',$1,true)", [B.id]);
		assert.equal((await restricted.query("select count(*)::int n from pm.projects where id=$1", [project.id])).rows[0].n, 0);
		await restricted.query("select set_config('pm.owner_id','',true),set_config('pm.guest_hash',$1,true)", [G.hash]);
		assert.equal((await restricted.query("select count(*)::int n from pm.projects where id=$1", [project.id])).rows[0].n, 0);
		// New access is exercised only inside this rolled-back verification transaction.
		const newLink = randomUUID(), newSession = randomUUID(), newGuest = hash(randomBytes(32)), linkHash = hash(randomBytes(32));
		await restricted.query("select set_config('pm.owner_id',$1,true),set_config('pm.guest_hash','',true)", [A.id]);
		await restricted.query("update pm.projects set archived_at=null,revision=revision+1 where id=$1", [project.id]);
		await restricted.query("insert into pm.share_links(id,project_id,token_hash) values($1,$2,$3)", [newLink, project.id, linkHash]);
		await restricted.query("select set_config('pm.link_hash',$1,true)", [linkHash]);
		await restricted.query("insert into pm.guest_sessions(id,project_id,share_id,token_hash) values($1,$2,$3,$4)", [newSession, project.id, newLink, newGuest]);
		await restricted.query("select set_config('pm.owner_id','',true),set_config('pm.guest_hash',$1,true)", [newGuest]);
		assert.equal((await restricted.query("select count(*)::int n from pm.deliveries where project_id=$1 and state='published'", [project.id])).rows[0].n, 2);
		assert.equal((await restricted.query("select count(*)::int n from pm.deliveries where project_id=$1 and state='draft'", [project.id])).rows[0].n, 0);
		assert.equal((await restricted.query("select count(*)::int n from pm.file_assets where id=$1", [secretFile.id])).rows[0].n, 0);
		assert.equal((await restricted.query("select count(*)::int n from pm.annotation_revisions where project_id=$1", [project.id])).rows[0].n, 0);
		await restricted.query("rollback");
	} finally { await restricted.end(); }
	checks.push("restored runtime role preserves Owner isolation, fixed response/history, published and private draft boundaries; old Guest is denied");
	assert.equal((await service.projectDetail(G, project.id)).id, project.id);
	checks.push("source project/session remains intact; restoring target never revokes or overwrites source");
	stage = "tamper_rejection";
	const artifact = backup.objects[0]; assert.ok(artifact);
	const encryptedPath = path.join(runRoot, "backup", artifact.file), damaged = await readFile(encryptedPath); damaged[25] = (damaged[25] ?? 0) ^ 1;
	await writeFile(encryptedPath, damaged);
	const damagedName = `pm_restore_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
	await admin.query(`create database "${damagedName}"`);
	await admin.query(`comment on database "${damagedName}" is 'partmeasure:disposable-restore:v1'`);
	const damagedUrl = new URL(sourceUrl); damagedUrl.pathname = `/${damagedName}`;
	await assert.rejects(restoreBackup({ ...options, targetUrl: damagedUrl, workspace: path.join(runRoot, "damaged"), apply: true }));
	const empty = databaseClient(damagedUrl, ca); await empty.connect();
	try { assert.equal((await empty.query("select count(*)::int n from pg_tables where schemaname not in ('pg_catalog','information_schema')")).rows[0].n, 0); }
	finally { await empty.end(); }
	await assert.rejects(stat(path.join(runRoot, "damaged/private-objects")));
	checks.push("tampered encrypted object rejected before database restore or private-file publication");
	await mkdir("docs/evidence/p3-04", { recursive: true });
	await writeFile("docs/evidence/p3-04/native-recovery.json", JSON.stringify({ checkedAt: new Date().toISOString(), scope: "Disposable native PG18 plus actual filesystem private bytes, synthetic identities/data only; not Supabase Auth/Storage/cloud recovery acceptance", status: "PASS", objects: backup.objects.length, objectBytes: backup.objects.reduce((n,o) => n+o.bytes,0), tables: Object.keys(backup.tables).length, restoreMs, totalMs: Math.round(performance.now()-started), checks }, null, 2));
	console.log(JSON.stringify({ status: "PASS", checks: checks.length, objects: backup.objects.length, restoreMs }));
} catch (error) {
	const value = error as { code?: string; message?: string };
	const detail = /^[A-Z0-9_]+$/.test(value.message ?? "") ? value.message : "REDACTED";
	console.log(JSON.stringify({ status: "FAIL", stage, code: value.code ?? detail, detail })); process.exitCode = 1;
} finally { if (connected) await admin.end().catch(() => {}); await getPool().end(); }
