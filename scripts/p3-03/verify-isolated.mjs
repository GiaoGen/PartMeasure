// Small real-isolation check; connect with the actual restricted role, never grant it to an inspector.
import nextEnv from "@next/env";
import pg from "pg";
import { readFile, mkdir, writeFile } from "node:fs/promises";
nextEnv.loadEnvConfig(process.cwd());
const ref = "rvysclscetfqicpnzlra";
const clients = [];
const report = { checkedAt: new Date().toISOString(), projectRef: ref, scope: "Real isolated runtime PostgreSQL contexts/RLS/triggers; synthetic file metadata only. Not Auth identity, Storage HTTP, browser or phone acceptance.", results: [] };
let stage = "configuration";
try {
	const runtimeUrl = new URL(process.env.DATABASE_URL ?? "http://invalid");
	const adminUrl = new URL((await readFile("tmp/p0-1/admin-database-url.txt", "utf8")).trim());
	for (const [url, role] of [[runtimeUrl, "partmeasure_runtime"], [adminUrl, "postgres"]]) {
		if (decodeURIComponent(url.username) !== `${role}.${ref}` || !url.hostname.endsWith(".pooler.supabase.com")) throw Error("ISOLATED_ONLY");
		const password = decodeURIComponent(url.password);
		if (password.startsWith("[") && password.endsWith("]")) url.password = encodeURIComponent(password.slice(1, -1));
		url.searchParams.delete("sslmode");
	}
	const ca = process.env.DATABASE_CA_PEM ?? await readFile(process.env.DATABASE_CA_FILE ?? "", "utf8");
	function connect(url) {
		const client = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: true, ca }, connectionTimeoutMillis: 10000, query_timeout: 20000 });
		client.on("error", () => {}); clients.push(client); return client;
	}
	stage = "inspector_read_existing_test_identities";
	const inspector = connect(adminUrl); await inspector.connect();
	const identities = (await inspector.query("select id from auth.users order by id limit 2")).rows;
	if (identities.length !== 2) throw Error("TWO_EXISTING_TEST_USERS_REQUIRED");
	await inspector.end();
	stage = "restricted_runtime_connection";
	const runtime = connect(runtimeUrl); await runtime.connect();
	await runtime.query("select set_config('pm.fixture_owner_a',$1,false),set_config('pm.fixture_owner_b',$2,false)", [identities[0].id, identities[1].id]);
	stage = "rolled_back_runtime_boundaries";
	const sql = await readFile("scripts/p3-03/verify-isolated.sql", "utf8");
	const output = await runtime.query(sql);
	const evidence = output.flatMap(result => result.rows ?? []).find(row => row.evidence)?.evidence;
	if (!evidence) throw Error("EVIDENCE_MISSING");
	report.results.push({ stage, status: "PASS", evidence });
} catch (error) {
	const known = ["ISOLATED_ONLY", "TWO_EXISTING_TEST_USERS_REQUIRED", "EVIDENCE_MISSING"];
	const code = /^[A-Z0-9_]{2,50}$/.test(error?.code ?? "") ? error.code : known.includes(error?.message) ? error.message : "CONNECTION_OR_ASSERTION_FAILED";
	report.results.push({ stage, status: "NOT_PASSED", code }); process.exitCode = 1;
} finally {
	for (const client of clients) { await client.query("rollback").catch(() => {}); await client.end().catch(() => {}); }
	await mkdir("docs/evidence/p3-03", { recursive: true });
	await writeFile("docs/evidence/p3-03/runtime-database.json", `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report));
}
