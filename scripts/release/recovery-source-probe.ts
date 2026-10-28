// One bounded read-only source diagnostic. No backup batch, target write or network change.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { EventEmitter } from "node:events";
import type { TLSSocket } from "node:tls";
import type { QueryConfig } from "pg";
import nextEnv from "@next/env";
import { sourceAllowed } from "../maintenance/backup-model";
import { databaseClient } from "../maintenance/backup";
import { connectionFailure } from "../maintenance/connection-model";

assert.deepEqual(process.argv.slice(2), ["--probe"]);
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const url = new URL((await readFile("tmp/p0-1/admin-database-url.txt", "utf8")).trim());
url.port = "5432";
const password = decodeURIComponent(url.password);
if (password.startsWith("[") && password.endsWith("]")) url.password = encodeURIComponent(password.slice(1, -1));
assert.ok(sourceAllowed(url, false));
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
const ca = await readFile(process.env.DATABASE_CA_FILE as string, "utf8");
await writeFile("tmp/p3-05/recovery-source-probe.pending", new Date().toISOString(), { flag: "wx" });
const db = databaseClient(url, ca);
// The pinned pg runtime supports this per-query field; QueryConfig omits it.
const query = (text: string, query_timeout = 8000) => {
	const config: QueryConfig & { query_timeout: number } = { text, query_timeout };
	return db.query(config);
};
const observed = db as unknown as { connection: EventEmitter & { stream: TLSSocket } };
const started = performance.now();
const phases: { phase: string; milliseconds: number }[] = [];
const phase = (name: string) => phases.push({ phase: name, milliseconds: Math.round(performance.now() - started) });
let connected = false;
let asyncError: Error | undefined;
const report: Record<string, unknown> = {
	checkedAt: new Date().toISOString(), source: "rvysclscetfqicpnzlra", status: "NOT_PASSED",
	scope: "One strict TLS/session admin connection; read-only snapshot and 10-second hold. No cloud writes/full backup/network changes. Does not prove long-run stability.",
	caSha256: createHash("sha256").update(ca).digest("hex"), phases,
};
db.on("error", error => { asyncError = error; phase("asynchronous_connection_error"); });
observed.connection.once("connect", () => phase("tcp_connected"));
observed.connection.once("sslconnect", () => {
	phase("tls_requested");
	observed.connection.stream.once("secureConnect", () => {
		phase("tls_verified"); report.tlsAuthorized = observed.connection.stream.authorized;
	});
});
observed.connection.once("authenticationSASL", () => phase("authentication_challenge"));
const deadline = setTimeout(() => { phase("diagnostic_deadline"); observed.connection.stream.destroy(); }, 40000);
try {
	await db.connect(); connected = true; phase("authenticated");
	assert.ok(observed.connection.stream.authorized);
	report.tlsAuthorized = true;
	await query("begin isolation level repeatable read read only");
	const row = (await query("select current_setting('server_version') as version, pg_export_snapshot() is not null as exported, (select count(*)::int from pg_tables where schemaname='pm') as tables")).rows[0];
	assert.equal(row.tables, 24); assert.equal(row.exported, true); phase("snapshot_exported");
	await new Promise(resolve => setTimeout(resolve, 10000));
	if (asyncError) throw asyncError;
	await query("select 1"); phase("snapshot_hold_verified");
	await query("rollback");
	report.status = "PASS"; report.serverVersion = row.version; report.businessTables = row.tables;
} catch (error) {
	report.failure = connectionFailure(error);
	const code = (error as { code?: string }).code;
	if (code && /^[0-9A-Z]{5}$/.test(code)) report.sqlState = code;
} finally {
	clearTimeout(deadline);
	if (connected) await query("rollback", 2000).catch(() => {});
	await db.end().catch(() => {});
	report.milliseconds = Math.round(performance.now() - started);
	await writeFile("docs/evidence/p3-05/recovery-source-probe.json", `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report));
	if (report.status !== "PASS") process.exitCode = 1;
}
