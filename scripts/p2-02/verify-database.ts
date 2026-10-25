// Real isolated Postgres checks. Fixture writes are contained in one rolled-back transaction.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { listFeedback } from "../../src/lib/server/delivery-feedback-service";
import { getPool } from "../../src/lib/server/db";

const ref = "rvysclscetfqicpnzlra";
const adminUrl = new URL((await readFile("tmp/p0-1/admin-database-url.txt", "utf8")).trim());
const runtimeUrl = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (!adminUrl.username.endsWith(`.${ref}`) || !runtimeUrl.username.endsWith(`.${ref}`) || process.env.PM_NETWORK_MODE !== "direct") throw Error("ISOLATED_DIRECT_ONLY");
const pass = decodeURIComponent(adminUrl.password);
if (pass.startsWith("[") && pass.endsWith("]")) adminUrl.password = encodeURIComponent(pass.slice(1, -1));
adminUrl.searchParams.delete("sslmode");
runtimeUrl.searchParams.delete("sslmode");
const ssl = { rejectUnauthorized: true, ca: await readFile(process.env.DATABASE_CA_FILE as string, "utf8") };
const inspector = new pg.Client({ connectionString: adminUrl.href, ssl, connectionTimeoutMillis: 10000 });
const db = new pg.Client({ connectionString: runtimeUrl.href, ssl, connectionTimeoutMillis: 10000 });
const results: { name: string; status: string; code?: string }[] = [];
const readerOnly = process.argv.includes("--reader-only");
let step = "connect";
let began = false;
try {
	await inspector.connect();
	step = "load_fixture";
	const fixture = JSON.parse(await readFile("tmp/p0-4/fixture.json", "utf8"));
	step = "read_existing_delivery";
	const info = (await inspector.query("select p.owner_id,d.id as delivery_id from pm.projects p join pm.deliveries d on d.project_id=p.id and d.state='published' where p.id=$1 order by d.version_no desc limit 1", [fixture.projectA])).rows[0];
	assert.ok(info);
	const owner = info.owner_id as string, project = fixture.projectA as string, delivery = info.delivery_id as string;
	if (!readerOnly) {
	step = "connect_restricted_runtime";
	await db.connect();
	step = "begin_fixture_transaction";
	await db.query("begin"); began = true;
	await db.query("set local statement_timeout='10000'");
	const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
	const guestHash = hash(), otherHash = hash();
	const linkHash = hash();
	await db.query("select set_config('pm.owner_id',$1,true),set_config('pm.guest_hash','',true)", [owner]);
	const link = (await db.query("insert into pm.share_links(project_id,token_hash) values($1,$2) returning id", [project, linkHash])).rows[0].id;
	await db.query("select set_config('pm.link_hash',$1,true)", [linkHash]);
	const session = (await db.query("insert into pm.guest_sessions(project_id,share_id,token_hash) values($1,$2,$3) returning id", [project, link, guestHash])).rows[0].id;
	const otherSession = (await db.query("insert into pm.guest_sessions(project_id,share_id,token_hash) values($1,$2,$3) returning id", [project, link, otherHash])).rows[0].id;
	const draft = (await db.query("insert into pm.deliveries(project_id,created_by) values($1,$2) returning id", [project, owner])).rows[0].id;
	assert.equal((await db.query("select current_user as role")).rows[0].role, "partmeasure_runtime");
	async function asGuest(value = guestHash) { await db.query("select set_config('pm.owner_id','',true),set_config('pm.guest_hash',$1,true)", [value]); }
	async function append(kind: string, target: string | null = null, sessionId = session, version = delivery) {
		return (await db.query("insert into pm.delivery_feedback(project_id,delivery_id,guest_session_id,kind,body,guest_label,target_id) values($1,$2,$3,$4,$5,'P2-02验证',$6) returning id", [project, version, sessionId, kind, kind === "comment" ? "隔离测试留言，事务回滚" : "", target])).rows[0].id as string;
	}
	async function denied(work: () => Promise<unknown>, codes: string[]) {
		await db.query("savepoint expected_denial"); let code: string | undefined;
		try { await work(); } catch (error) { code = (error as { code?: string }).code; }
		await db.query("rollback to savepoint expected_denial");
		assert.ok(code && codes.includes(code), "EXPECTED_DENIAL");
	}
	step = "guest_append_upgrade_and_withdrawal";
	await asGuest();
	const comment = await append("comment");
	const received = await append("received");
	await denied(() => append("received"), ["23514"]);
	const accepted = await append("accepted");
	await denied(() => append("received"), ["23514"]);
	await asGuest(otherHash);
	await denied(() => append("withdrawn", accepted, otherSession), ["23514"]);
	await asGuest();
	await append("withdrawn", accepted);
	assert.equal((await db.query("select count(*)::int as n from pm.delivery_feedback where project_id=$1 and delivery_id=$2 and id=any($3::uuid[])", [project, delivery, [comment, received, accepted]])).rows[0].n, 3);
	await denied(() => append("withdrawn", accepted), ["23514"]);
	await append("received");
	results.push({ name: step, status: "PASS" });
	step = "draft_and_history_mutation_denied";
	await denied(() => append("comment", null, session, draft), ["23514"]);
	await denied(() => db.query("update pm.delivery_feedback set body='overwrite' where id=$1", [comment]), ["42501", "23514"]);
	await denied(() => db.query("delete from pm.delivery_feedback where id=$1", [comment]), ["42501", "23514"]);
	results.push({ name: step, status: "PASS" });
	step = "owner_read_only_and_project_isolation";
	await db.query("select set_config('pm.owner_id',$1,true),set_config('pm.guest_hash','',true)", [owner]);
	assert.ok((await db.query("select id from pm.delivery_feedback where id=$1", [comment])).rowCount);
	await denied(() => append("comment"), ["42501"]);
	await db.query("select set_config('pm.owner_id',$1,true)", [randomUUID()]);
	assert.equal((await db.query("select id from pm.delivery_feedback where project_id=$1", [project])).rowCount, 0);
	results.push({ name: step, status: "PASS" });
	step = "revocation_denies_feedback_reads_and_writes";
	await db.query("select set_config('pm.owner_id',$1,true),set_config('pm.guest_hash','',true)", [owner]);
	await db.query("update pm.share_links set revoked_at=now() where id=$1", [link]);
	await asGuest();
	assert.equal((await db.query("select id from pm.delivery_feedback where project_id=$1", [project])).rowCount, 0);
	await denied(() => append("comment"), ["42501"]);
	results.push({ name: step, status: "PASS" });
	await db.query("rollback"); began = false;
	}
	// Release inspection/rollback connections before opening the application pool.
	await db.end(); await inspector.end();
	step = "actual_runtime_feedback_reader";
	const page = await listFeedback({ kind: "owner", id: owner }, project, delivery, null);
	assert.equal(page.myReceipt, null); assert.ok(page.items.length <= 20);
	assert.ok(page.items.every(item => !("guestSessionId" in item) && !("ordinal" in item)));
	results.push({ name: step, status: "PASS" });
} catch (error) {
	const detail = String((error as { message?: string }).message ?? "");
	const code = (error as { code?: string }).code ?? (/timeout/i.test(detail) ? "CONNECTION_TIMEOUT" : /password/i.test(detail) ? "DATABASE_LOGIN_FAILED" : /terminated|closed/i.test(detail) ? "CONNECTION_CLOSED" : "ASSERTION_OR_DEPENDENCY");
	results.push({ name: step, status: "FAIL", code: /^[A-Z0-9_]{2,50}$/.test(code) ? code : "DEPENDENCY" }); process.exitCode = 1;
} finally {
	if (began) await db.query("rollback").catch(() => {});
	await db.end().catch(() => {}); await inspector.end().catch(() => {}); await getPool().end();
	const report = { checkedAt: new Date().toISOString(), projectRef: ref, scope: "Real isolated Postgres RLS/trigger/transaction checks using restricted runtime role; all fixture writes rolled back. Actual DAL read after rollback. No browser, HTTP business-flow or mobile acceptance; not an Auth identity test.", results };
	await mkdir("docs/evidence/p2-02", { recursive: true });
	await writeFile(`docs/evidence/p2-02/${readerOnly ? "reader" : "database"}.json`, `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report));
}
