// Disposable native PostgreSQL only. Synthetic Auth identities are never remote SQL.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import * as service from "../../src/lib/server/service";
import { transaction, getPool, digest, type Actor } from "../../src/lib/server/db";
import { projectChanges } from "../../src/lib/server/project-changes";
import { eventCursor, eventSequence } from "../../src/lib/server/event-cursor";
import { SessionNotifications } from "../../src/lib/server/session-notifications";
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
const A: Actor = { kind: "owner", id: randomUUID() },
	B: Actor = { kind: "owner", id: randomUUID() };
const results: { check: string; status: string; code?: string }[] = [];
async function check(name: string, run: () => Promise<void>) {
	try {
		await run();
		results.push({ check: name, status: "PASS" });
	} catch (e) {
		const error = e as { code?: string; name?: string };
		results.push({ check: name, status: "FAIL", code: error.code ?? error.name ?? "UNKNOWN" });
	}
	process.stdout.write(`${name}: ${results.at(-1)?.status} ${results.at(-1)?.code ?? ""}\n`);
}
const rejects = (work: Promise<unknown>, code: string) =>
	assert.rejects(work, (e: { code?: string }) => e.code === code);
const notices: string[] = [];
const notifications = new SessionNotifications("pm_project_events");
let off: (() => void) | undefined;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
await admin.connect();
try {
	await admin.query("insert into auth.users(id) values($1),($2)", [A.id, B.id]);
	const project = await service.createProject(
		A,
		{ name: "s34 synthetic", description: "" },
		randomUUID(),
	);
	const share = await service.rotateShare(A, project.id, randomUUID());
	assert.ok(share.url);
	const session = await service.bootstrap(share.url.split("/").at(-1) ?? "");
	const guest: Actor = { kind: "guest", hash: digest(session.secret) };
	let ownerCursor = (await service.projectDetail(A, project.id)).syncCursor;
	let guestCursor = (await service.projectDetail(guest, project.id)).syncCursor;
	await check("scope-bound-cursors-and-owner-isolation", async () => {
		assert.ok(eventSequence(A, project.id, ownerCursor));
		assert.throws(() => eventSequence(guest, project.id, ownerCursor));
		await rejects(projectChanges(B, project.id, null), "NOT_FOUND");
	});
	off = await notifications.subscribe({ change: (p) => notices.push(p), dropped: () => {} });
	await check("session-LISTEN-commit-notify-rollback-no-event", async () => {
		await admin.query("begin");
		await admin.query("update pm.projects set description='commit' where id=$1", [project.id]);
		await pause(100);
		assert.equal(notices.length, 0);
		await admin.query("commit");
		await pause(100);
		assert.equal(notices.at(-1), project.id);
		const n = notices.length;
		const before = (await projectChanges(A, project.id, ownerCursor)).sequence;
		await admin.query("begin");
		await admin.query("update pm.projects set description='rollback' where id=$1", [
			project.id,
		]);
		await admin.query("rollback");
		await pause(100);
		assert.equal(notices.length, n);
		assert.equal((await projectChanges(A, project.id, ownerCursor)).sequence, before);
	});
	await check("ordered-concurrent-events-and-reconnect-replay", async () => {
		const before = await projectChanges(A, project.id, ownerCursor);
		ownerCursor = before.cursor;
		await Promise.all(
			[1, 2].map((n) =>
				transaction(A, async (db) => {
					await db.query(
						"select pm.emit_project_event($1,'project.changed',$1,null,$2,null,true)",
						[project.id, n],
					);
					if (n === 1) await db.query("select pg_sleep(0.05)");
				}),
			),
		);
		const batch = await projectChanges(A, project.id, ownerCursor);
		assert.equal(batch.events.length, 2);
		const first = batch.events[0],
			second = batch.events[1];
		assert.ok(first && second);
		assert.equal(BigInt(second.sequence), BigInt(first.sequence) + 1n);
		assert.deepEqual((await projectChanges(A, project.id, ownerCursor)).events, batch.events);
		ownerCursor = batch.cursor;
	});
	await check("private-draft-does-not-advance-Guest-or-leak-activity", async () => {
		const before = await projectChanges(guest, project.id, guestCursor);
		guestCursor = before.cursor;
		await transaction(A, (db) =>
			db.query(
				"insert into pm.deliveries(project_id,description,created_by) values($1,'private',$2)",
				[project.id, A.id],
			),
		);
		const after = await projectChanges(guest, project.id, guestCursor);
		assert.equal(after.sequence, before.sequence);
		assert.equal(after.events.length, 0);
		assert.equal(
			(await projectChanges(A, project.id, ownerCursor)).events[0]?.kind,
			"delivery.changed",
		);
	});
	await check("retention-reset-and-oversized-catchup", async () => {
		await admin.query(
			"update pm.project_event_cursors set owner_floor=owner_seq where project_id=$1",
			[project.id],
		);
		assert.equal(
			(await projectChanges(A, project.id, eventCursor(A, project.id, "0"))).reset,
			true,
		);
		await admin.query(
			"select pm.emit_project_event($1,'project.changed',$1,null,null,null,true) from generate_series(1,102)",
			[project.id],
		);
		assert.equal((await projectChanges(guest, project.id, guestCursor)).reset, true);
	});
	await check("browser-roles-no-outbox-or-derivative-grants", async () => {
		for (const table of [
			"project_events",
			"project_event_cursors",
			"image_derivatives",
			"thumbnail_jobs",
		]) {
			const r = await admin.query(
				"select has_table_privilege('anon',$1,'SELECT') as a,has_table_privilege('authenticated',$1,'SELECT') as b",
				[`pm.${table}`],
			);
			assert.equal(r.rows[0].a, false);
			assert.equal(r.rows[0].b, false);
		}
	});
	await check("thumbnail-RLS-original-size-bound-and-immutability", async () => {
		const id = randomUUID(),
			hash = "a".repeat(64);
		await admin.query(
			"insert into pm.upload_reservations(id,project_id,actor_key,filename,extension,declared_mime,byte_size,sha256,reserved_bytes,quarantine_key,state) values($1,$2,$3,'synthetic.png','png','image/png',128,$4,256,$5,'ready')",
			[id, project.id, `owner:${A.id}`, hash, randomUUID()],
		);
		await admin.query(
			"insert into pm.file_assets(id,project_id,reservation_id,filename,mime,extension,byte_size,original_bytes,storage_key,original_key,sha256,original_sha256,width,height,normalization_version,uploader_type) values($1,$2,$1,'synthetic.png','image/webp','png',128,128,$3,$4,$5,$5,100,80,1,'owner')",
			[id, project.id, randomUUID(), randomUUID(), hash],
		);
		const insert = (width: number, height: number) =>
			transaction(
				null,
				(db) =>
					db.query(
						"insert into pm.image_derivatives(project_id,file_id,variant,storage_key,sha256,image_hash,byte_size,width,height) values($1,$2,320,$3,$4,$4,100,$5,$6)",
						[project.id, id, `${project.id}/${id}/thumb-320.webp`, hash, width, height],
					),
				true,
			);
		await rejects(insert(200, 160), "42501");
		await insert(100, 80);
		assert.equal(
			(await service.fileForRead(guest, project.id, id, false, 320)).byte_size,
			"100",
		);
		await rejects(service.fileForRead(B, project.id, id, false, 320), "NOT_FOUND");
		await rejects(
			transaction(
				null,
				(db) => db.query("update pm.image_derivatives set byte_size=99 where file_id=$1", [id]),
				true,
			),
			"42501",
		);
		await rejects(
			transaction(
				null,
				(db) => db.query("delete from pm.image_derivatives where file_id=$1", [id]),
				true,
			),
			"42501",
		);
		const internal = randomUUID(),
			internalHash = "b".repeat(64);
		await admin.query(
			"insert into pm.upload_reservations(id,project_id,actor_key,filename,extension,declared_mime,byte_size,sha256,reserved_bytes,quarantine_key,state) values($1,$2,$3,'private.png','png','image/png',128,$4,256,$5,'ready')",
			[internal, project.id, `owner:${A.id}`, internalHash, randomUUID()],
		);
		await admin.query(
			"insert into pm.file_assets(id,project_id,reservation_id,filename,mime,extension,byte_size,original_bytes,storage_key,original_key,sha256,original_sha256,width,height,normalization_version,uploader_type,visibility) values($1,$2,$1,'private.png','image/webp','png',128,128,$3,$4,$5,$5,100,80,1,'owner','internal')",
			[internal, project.id, randomUUID(), randomUUID(), internalHash],
		);
		const before = await projectChanges(guest, project.id, null);
		await transaction(
			null,
			(db) =>
				db.query(
					"insert into pm.image_derivatives(project_id,file_id,variant,storage_key,sha256,image_hash,byte_size,width,height) values($1,$2,320,$3,$4,$4,100,100,80)",
					[project.id, internal, `${project.id}/${internal}/thumb-320.webp`, internalHash],
				),
			true,
		);
		assert.equal((await projectChanges(guest, project.id, before.cursor)).events.length, 0);
		await rejects(service.fileForRead(guest, project.id, internal, false, 320), "NOT_FOUND");
	});
	await check("actual-worker-retention-cleanup-advances-floor", async () => {
		const old = (await projectChanges(A, project.id, null)).cursor;
		await admin.query(
			"update pm.project_events set created_at=now()-interval '8 days' where project_id=$1",
			[project.id],
		);
		execFileSync(
			process.execPath,
			[
				"--conditions=react-server",
				"--import",
				"tsx",
				"scripts/p0-1/worker.ts",
				"--cleanup-only",
			],
			{ env: process.env, timeout: 30000, windowsHide: true, stdio: "pipe" },
		);
		const count = (
			await admin.query(
				"select count(*)::int as n from pm.project_events where project_id=$1",
				[project.id],
			)
		).rows[0].n;
		assert.equal(count, 0);
		const floor = (
			await admin.query(
				"select owner_floor,owner_seq from pm.project_event_cursors where project_id=$1",
				[project.id],
			)
		).rows[0];
		assert.equal(floor.owner_floor, floor.owner_seq);
		assert.equal(
			(await projectChanges(A, project.id, eventCursor(A, project.id, "0"))).reset,
			true,
		);
		assert.equal((await projectChanges(A, project.id, old)).reset, false);
	});
	await check("revocation-rejects-replay-and-new-session-scope", async () => {
		await service.revokeShare(A, project.id, share.id, randomUUID());
		await rejects(projectChanges(guest, project.id, guestCursor), "LINK_UNAVAILABLE");
		await projectChanges(A, project.id, ownerCursor);
	});
} finally {
	off?.();
	notifications.stop();
	await admin.end();
	await getPool().end();
	await getPool(true).end();
	await mkdir("docs/evidence/performance-s34", { recursive: true });
	await writeFile(
		"docs/evidence/performance-s34/native.json",
		JSON.stringify(
			{ environment: "disposable native PG; synthetic Auth; no Storage proof", results },
			null,
			2,
		),
	);
}
if (results.some((r) => r.status !== "PASS")) process.exitCode = 1;
