// Disposable native PG only. Uses the same runtime SQL, with local Auth/Storage schema fixtures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import pg from "pg";
const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.PM_EVENTS_LOCAL !== "disposable-native-pg" || url.hostname !== "127.0.0.1" || url.port !== "55448") throw Error("LOCAL_ONLY");
const ssl = { rejectUnauthorized: true, ca: await readFile(process.env.DATABASE_CA_FILE ?? "", "utf8") };
const admin = new pg.Client({ host: url.hostname, port: 55448, user: "postgres", database: "postgres", ssl });
const db = new pg.Client({ host: url.hostname, port: 55448, user: "partmeasure_runtime", database: "postgres", ssl });
const a = randomUUID(), b = randomUUID();
const report: { scope: string; results: unknown[] } = { scope: "Disposable local PostgreSQL, migrated schema, restricted runtime role, synthetic Auth/schema metadata. Not isolated Supabase/Auth/Storage/HTTP acceptance.", results: [] };
try {
	await admin.connect(); await admin.query("insert into auth.users(id) values($1),($2)", [a, b]);
	await db.connect();
	await db.query("select set_config('pm.fixture_owner_a',$1,false),set_config('pm.fixture_owner_b',$2,false)", [a, b]);
	const results = await db.query(await readFile("scripts/p3-03/verify-isolated.sql", "utf8")) as unknown as pg.QueryResult[];
	const evidence = results.flatMap(item => item.rows ?? []).find(row => row.evidence)?.evidence;
	assert.ok(evidence);
	assert.equal((await admin.query("select count(*)::int as n from pm.projects where owner_id=any($1::uuid[])", [[a, b]])).rows[0].n, 0);
	report.results.push({ status: "PASS", evidence });
} catch (error) {
	const value = error as { code?: string; message?: string };
	report.results.push({ status: "FAIL", code: value.code ?? "ASSERTION_FAILED", detail: /^[A-Z0-9_]+$/.test(value.message ?? "") ? value.message : "REDACTED" }); process.exitCode = 1;
} finally {
	await db.query("rollback").catch(() => {}); await db.end().catch(() => {}); await admin.end().catch(() => {});
	await mkdir("docs/evidence/p3-03", { recursive: true });
	await writeFile("docs/evidence/p3-03/native-database.json", `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report));
}
