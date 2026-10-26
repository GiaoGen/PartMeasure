// Independent Auth test-account login + restricted PostgreSQL SELECT only. No application server.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
const ref = "rvysclscetfqicpnzlra";
const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid");
const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (origin.hostname !== `${ref}.supabase.co` || decodeURIComponent(url.username) !== `partmeasure_runtime.${ref}`) throw Error("ISOLATED_RUNTIME_ONLY");
url.searchParams.delete("sslmode");
const safe = error => {
	const found = [];
	for (const value of [error, error?.cause, ...(error?.errors ?? [])]) {
		if (/^[A-Z0-9_]{2,60}$/.test(value?.code ?? "")) found.push(value.code);
		if (/^[A-Za-z]{2,50}$/.test(value?.name ?? "")) found.push(value.name);
		if (/timeout/i.test(value?.message ?? "")) found.push("TIMEOUT");
	}
	return [...new Set(found)];
};
async function authProbe() {
	const account = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8")).A;
	const start = performance.now();
	const auth = createClient(origin.href, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false },
		global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) }) },
	});
	try {
		const { data, error } = await auth.auth.signInWithPassword(account);
		return { name: "independent_auth_test_account", ms: Math.round(performance.now() - start), authenticated: !!data.user?.email_confirmed_at && !!data.session && !error, ...(error ? { status: error.status, errors: safe(error) } : {}) };
	} catch (error) { return { name: "independent_auth_test_account", ms: Math.round(performance.now() - start), errors: safe(error) }; }
}
async function databaseProbe() {
	const ca = process.env.DATABASE_CA_PEM || (process.env.DATABASE_CA_FILE ? await readFile(process.env.DATABASE_CA_FILE, "utf8") : undefined);
	const start = performance.now(), phases = {};
	const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) }, connectionTimeoutMillis: 10000, query_timeout: 5000 });
	db.on("error", () => {});
	db.connection.once("connect", () => { phases.tcpMs = Math.round(performance.now() - start); });
	db.connection.once("sslconnect", () => {
		phases.sslResponseMs = Math.round(performance.now() - start);
		db.connection.stream.once("secureConnect", () => { phases.verifiedTlsMs = Math.round(performance.now() - start); });
	});
	try {
		await db.connect(); phases.authenticatedMs = Math.round(performance.now() - start);
		const result = await db.query("select current_user as role,1::int as ok");
		return { name: "restricted_database_select", ms: Math.round(performance.now() - start), phases, success: result.rows[0]?.role === "partmeasure_runtime" && result.rows[0]?.ok === 1 };
	} catch (error) { return { name: "restricted_database_select", ms: Math.round(performance.now() - start), phases, errors: safe(error) }; }
	finally { await db.end().catch(() => {}); }
}
const results = await Promise.all([authProbe(), databaseProbe()]);
const report = { checkedAt: new Date().toISOString(), projectRef: ref, scope: "Current user-provided TUN path, process HTTP proxy disabled; independent normal test-account Auth login and restricted SELECT only. Not mainland no-TUN verification.", results };
await mkdir("docs/evidence/auth-direct", { recursive: true });
const path = `docs/evidence/auth-direct/login-dependencies-${Date.now()}.json`;
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report)); console.log(`Report: ${path}`);
