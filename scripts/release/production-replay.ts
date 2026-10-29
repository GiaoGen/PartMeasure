// Local empty-schema replay only. These Auth/Storage fixtures must NEVER run in Supabase.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import pg from "pg";

assert.deepEqual(process.argv.slice(2), ["--local-only"]);
assert.equal(process.env.PM_PRODUCTION_REPLAY, "disposable-local-cluster");
const db = new pg.Client({ host: "127.0.0.1", port: 55449, user: "postgres", database: "postgres", connectionTimeoutMillis: 5000, query_timeout: 15000 });
db.on("error", () => {});
const files = (await readdir("supabase/migrations")).filter(n => /^\d{14}_[a-z0-9_]+\.sql$/.test(n)).sort();
assert.equal(files.length, 20);
const migrations = await Promise.all(files.map(async file => {
	const sql = await readFile(`supabase/migrations/${file}`, "utf8");
	return { file, sql, sha256: createHash("sha256").update(sql).digest("hex") };
}));
let phase = "connect";
try {
	await db.connect();
	assert.equal((await db.query("select count(*)::int n from pg_namespace where nspname in ('pm','auth','storage')")).rows[0].n, 0);
	phase = "local-provider-fixtures";
	await db.query(`create role anon nologin; create role authenticated nologin;
	 create schema auth; create table auth.users(id uuid primary key);
	 create schema storage; create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint);
	 create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);`);
	await db.query("begin");
	for (const m of migrations) {
		phase = m.file;
		await db.query(m.sql);
		await db.query("insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)", [m.file.slice(0, 14), m.file.slice(15, -4), [m.sql]]);
	}
	await db.query("commit"); phase = "empty-schema-checks";
	const tables = (await db.query<{ name: string; rls: boolean }>("select c.relname as name,c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pm' and c.relkind='r' order by c.relname")).rows;
	assert.equal(tables.length, 24); assert.ok(tables.every(t => t.rls));
	for (const t of tables) { assert.match(t.name, /^[a-z_]+$/); assert.equal((await db.query(`select count(*)::int n from pm."${t.name}"`)).rows[0].n, 0); }
	const roles = (await db.query("select rolname,rolsuper,rolbypassrls,rolinherit from pg_roles where rolname in ('partmeasure_runtime','partmeasure_worker') order by rolname")).rows;
	assert.equal(roles.length, 2); assert.ok(roles.every(r => !r.rolsuper && !r.rolbypassrls && !r.rolinherit));
	assert.equal((await db.query("select count(*)::int n from storage.buckets where public")).rows[0].n, 0);
	assert.equal((await db.query("select count(*)::int n from storage.buckets")).rows[0].n, 2);
	for (const role of ["anon", "authenticated"]) assert.equal((await db.query("select has_schema_privilege($1,'pm','usage') as allowed", [role])).rows[0].allowed, false);
	const runtime = new pg.Client({ host: "127.0.0.1", port: 55449, user: "partmeasure_runtime", database: "postgres", connectionTimeoutMillis: 5000 });
	try { await runtime.connect(); assert.equal((await runtime.query("select count(*)::int n from pm.projects")).rows[0].n, 0); } finally { await runtime.end(); }
	const report = { checkedAt: new Date().toISOString(), status: "PASS", scope: "Fresh disposable native PostgreSQL18 empty migration chain; local auth.users/storage.buckets fixtures only. NOT cloud Auth, Storage, TLS or production acceptance.",
		migrations: migrations.map(({ file, sha256 }) => ({ file, sha256 })), tables: tables.map(t => ({ name: t.name, rls: t.rls, rows: 0 })), roles,
		privateBuckets: 2, testUsersSeeded: 0, labSqlApplied: false, draftSqlApplied: false, browserSchemaAccess: false, cloudWrites: false };
	await writeFile("docs/evidence/p3-05/production-empty-replay.json", `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify({ status: "PASS", migrations: migrations.length, emptyBusinessTables: tables.length, privateBuckets: 2, cloudAcceptance: false }));
} catch (e) {
	await db.query("rollback").catch(() => {});
	const code = (e as { code?: string }).code;
	console.error(JSON.stringify({ status: "FAIL", phase, code: code && /^[A-Z0-9_]+$/.test(code) ? code : "LOCAL_REPLAY_FAILED" })); process.exitCode = 1;
} finally { await db.end().catch(() => {}); }
