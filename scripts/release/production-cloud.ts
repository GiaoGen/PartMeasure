// Exact newly approved production target only. Never loads the lab .env files.
import assert from "node:assert/strict";
import path from "node:path";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, readdir, writeFile, rename } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { databaseClient } from "../maintenance/backup";
import { sourceAllowed } from "../maintenance/backup-model";
import { backupKey } from "../maintenance/encrypted-file";
import { connectionFailure } from "../maintenance/connection-model";
import { productionProjectRef as ref } from "../maintenance/project-target";

async function main() {
const root = path.resolve("tmp/p3-05/production");
const read = async (name: string) => (await readFile(path.join(root, name), "utf8")).trim();
const controllerFile = path.join(root, "controller.json");
const state = JSON.parse(await readFile(controllerFile, "utf8"));
assert.equal(state.approved, true); assert.equal(state.targetRef, ref); assert.equal(state.targetName, "partmeasure-v1-production");
assert.equal(state.organizationId, "mndzgvsjfzqrejuqldvm"); assert.equal(state.vercelProjectId, "prj_Tk3LzDCt2iLIfObnwVyPajjbiX61");
const args = process.argv.slice(2); assert.ok(args.length === 1 && ["--probe", "--initialize", "--verify"].includes(args[0] ?? ""));
const action = args[0];
const save = async () => { const file = path.join(root, `${randomUUID()}.json`); await writeFile(file, JSON.stringify(state), { flag: "wx", mode: 0o600 }); await rename(file, controllerFile); };
const url = new URL(await read("database-url.txt"));
if (["[YOUR-PASSWORD]", "[YOUR_PASSWORD]", "YOUR_PASSWORD"].includes(decodeURIComponent(url.password))) url.password = encodeURIComponent(await read("target-database-password.txt"));
if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
assert.ok(sourceAllowed(url, false, ref), "EXACT_PRODUCTION_SESSION_URL_REQUIRED");
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
const caFile = path.join(root, "database-ca.crt"), ca = await read("database-ca.crt"); assert.ok(ca.includes("-----BEGIN CERTIFICATE-----"), "PRODUCTION_CA_REQUIRED");
const secret = await read("service-key.txt"), publicKey = await read("publishable-key.txt");
assert.ok(secret.startsWith("sb_secret_") || secret.startsWith("eyJ"), "PRODUCTION_SERVICE_KEY_REQUIRED");
assert.ok(publicKey.startsWith("sb_publishable_"));
const backupKeyFile = path.resolve("tmp/maintenance-keys/production-v1/backup.backup-key");
assert.ok(timingSafeEqual(await backupKey(backupKeyFile), await backupKey(path.join(root, "from-phone.backup-key"))), "PRODUCTION_PHONE_KEY_MISMATCH");
const runtimePassword = await read("runtime-password.txt"), maintenancePassword = await read("maintenance-password.txt");
assert.match(runtimePassword, /^[A-Za-z0-9_-]{43}$/); assert.match(maintenancePassword, /^[A-Za-z0-9_-]{43}$/);
assert.notEqual(runtimePassword, maintenancePassword); assert.notEqual(runtimePassword, decodeURIComponent(url.password));
const apiSignal = AbortSignal.timeout(30000);
const storage = createClient(`https://${ref}.supabase.co`, secret, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: apiSignal }) } }).storage;
const db = databaseClient(url, ca); db.on("error", () => {});
let phase = "connect", committed = false;
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), targetRef: ref, action, status: "NOT_PASSED", noSourceMutation: true, noUsersOrFilesImported: true, noEmailOrDeployment: true };
function roleUrl(role: string, password: string, port: string) { const value = new URL(url); value.username = `${role}.${ref}`; value.password = encodeURIComponent(password); value.port = port; value.search = ""; return value; }
const runtime = roleUrl("partmeasure_runtime", runtimePassword, "6543"), events = roleUrl("partmeasure_runtime", runtimePassword, "5432"), worker = roleUrl("partmeasure_worker", maintenancePassword, "6543");
async function privateArtifact(file: string, value: string) {
	try { assert.equal(await readFile(file, "utf8"), value, "EXISTING_PRIVATE_CONFIG_DIFFERS"); }
	catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; await writeFile(file, value, { flag: "wx", mode: 0o600 }); }
}
try {
	await db.connect(); assert.equal((await db.query("select current_user as role")).rows[0].role, "postgres");
	phase = "storage-key-and-target";
	const buckets = await storage.listBuckets(); if (buckets.error || !buckets.data) throw Error("PRODUCTION_STORAGE_CREDENTIAL_REJECTED");
	if (action === "--probe") {
		await db.query("begin read only");
		const row = (await db.query("select (select count(*)::int from pg_namespace where nspname='pm') as application_schema,(select count(*)::int from auth.users) as users,(select count(*)::int from storage.objects) as objects,(select count(*)::int from pg_roles where rolname in ('partmeasure_runtime','partmeasure_worker')) as roles")).rows[0];
		assert.deepEqual(row, { application_schema: 0, users: 0, objects: 0, roles: 0 }); assert.equal(buckets.data.length, 0);
		await db.query("rollback"); state.prerequisitesChecked = true; await save(); report.status = "PASS"; report.emptyTarget = row;
	} else if (action === "--initialize") {
		assert.equal(state.prerequisitesChecked, true); assert.ok(!state.initializationAttempted, "INITIALIZATION_ALREADY_ATTEMPTED");
		const proof = JSON.parse(await readFile("docs/evidence/p3-05/production-empty-replay.json", "utf8")); assert.equal(proof.status, "PASS");
		const files = (await readdir("supabase/migrations")).filter(n => /^\d{14}_[a-z0-9_]+\.sql$/.test(n)).sort(); assert.equal(files.length, 20);
		const migrations = await Promise.all(files.map(async file => { const sql = await readFile(`supabase/migrations/${file}`, "utf8"); assert.equal(createHash("sha256").update(sql).digest("hex"), proof.migrations.find((m: { file: string }) => m.file === file)?.sha256); return { file, sql }; }));
		await db.query("begin; set local statement_timeout='30000'; set local lock_timeout='5000'");
		assert.equal((await db.query("select count(*)::int n from pg_namespace where nspname='pm'")).rows[0].n, 0);
		assert.equal(buckets.data.length, 0);
		state.initializationAttempted = true; await save();
		await db.query("create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text not null primary key,statements text[],name text)");
		assert.equal((await db.query("select count(*)::int n from supabase_migrations.schema_migrations")).rows[0].n, 0);
		for (const m of migrations) { phase = m.file; await db.query(m.sql); await db.query("insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)", [m.file.slice(0, 14), m.file.slice(15, -4), [m.sql]]); }
		phase = "independent-role-credentials";
		// Generated base64url values cannot contain SQL delimiters; never sent through connector/tool arguments or logs.
		await db.query(`alter role partmeasure_runtime password '${runtimePassword}'; alter role partmeasure_worker password '${maintenancePassword}';`);
		await db.query("commit"); committed = true; state.initialized = true; state.initializedAt = new Date().toISOString(); await save();
		report.status = "PASS"; report.migrations = files; report.committed = true;
	} else {
		assert.equal(state.initialized, true); phase = "production-schema-verification";
		const tables = (await db.query<{ name: string; rls: boolean }>("select c.relname as name,c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pm' and c.relkind='r' order by c.relname")).rows;
		assert.equal(tables.length, 24); assert.ok(tables.every(t => t.rls));
		for (const t of tables) { assert.match(t.name, /^[a-z_]+$/); assert.equal((await db.query(`select count(*)::int n from pm."${t.name}"`)).rows[0].n, 0); }
		assert.equal((await db.query("select count(*)::int n from auth.users")).rows[0].n, 0); assert.equal((await db.query("select count(*)::int n from storage.objects")).rows[0].n, 0);
		assert.equal(buckets.data.length, 2); assert.ok(buckets.data.every(b => !b.public && ["partmeasure-private", "partmeasure-quarantine"].includes(b.id)));
		const roles = (await db.query("select rolname,rolsuper,rolbypassrls,rolinherit from pg_roles where rolname in ('partmeasure_runtime','partmeasure_worker') order by rolname")).rows;
		assert.equal(roles.length, 2); assert.ok(roles.every(r => !r.rolsuper && !r.rolbypassrls && !r.rolinherit));
		const connections = [];
		for (const [name, connection] of [["runtime", runtime], ["event-session", events], ["maintenance", worker]] as const) {
			phase = `${name}-strict-tls`; const client = databaseClient(connection, ca); client.on("error", () => {});
			try { await client.connect(); assert.equal((await client.query("select current_user as role")).rows[0].role, name === "maintenance" ? "partmeasure_worker" : "partmeasure_runtime");
				if (name === "event-session") await client.query("listen pm_project_events; unlisten pm_project_events");
				else assert.equal((await client.query("select count(*)::int n from pm.projects")).rows[0].n, 0);
				connections.push({ name, verifiedTLS: true, normalRoleConnection: true });
			} finally { await client.end().catch(() => {}); }
		}
		phase = "private-production-configuration";
		await privateArtifact(path.join(root, "source-session-url.txt"), url.href);
		const environment = { APP_URL: "https://partmeasure-production.vercel.app", NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey, SUPABASE_SECRET_KEY: secret, DATABASE_URL: runtime.href, EVENT_DATABASE_URL: events.href, DATABASE_CA_PEM: ca, SUPABASE_PROJECT_REF: ref, STORAGE_MAX_FILE_BYTES: "52428800", PM_SERVER_TIMING: "0" };
		await privateArtifact(path.join(root, "environment.json"), JSON.stringify(environment));
		await privateArtifact(path.join(root, "maintenance-environment.json"), JSON.stringify({ ...environment, PM_MAINTENANCE_PROFILE: "production", WORKER_DATABASE_URL: worker.href, DATABASE_CA_FILE: caFile, PM_BACKUP_DATABASE_URL_FILE: path.join(root, "source-session-url.txt"), PM_BACKUP_KEY_FILE: backupKeyFile, PM_POSTGRES_BIN: "C:/Program Files/PostgreSQL/18/bin" }));
		state.verified = true; await save(); report.status = "PASS"; report.tables = tables; report.roles = roles; report.connections = connections; report.privateBuckets = 2; report.phoneKeyMatched = true;
	}
} catch (e) {
	await db.query("rollback").catch(() => {}); const code = (e as { code?: string }).code;
	report.phase = phase; report.failure = { ...connectionFailure(e), ...(code && /^[A-Z0-9_]{1,40}$/.test(code) ? { code } : {}) }; report.committed = committed;
	state.lastFailure = { phase, ...report.failure as object }; await save(); process.exitCode = 1;
} finally {
	await db.end().catch(() => {});
	await writeFile(`docs/evidence/p3-05/production-${action?.slice(2)}.json`, `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report));
}
}
main().catch(() => {
	// Configuration errors may contain a URL/password or assertion operands.
	console.error(JSON.stringify({ status: "NOT_PASSED", phase: "configuration", code: "PRODUCTION_CONFIGURATION_REQUIRED", credentialsPrinted: false }));
	process.exitCode = 1;
});
