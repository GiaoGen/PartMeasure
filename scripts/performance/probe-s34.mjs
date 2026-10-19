import pg from "pg";
import { readFile, mkdir, writeFile } from "node:fs/promises";
if (
	process.env.PM_NETWORK_MODE !== "direct" ||
	new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "rvysclscetfqicpnzlra.supabase.co"
)
	throw Error("WRONG_TEST_MODE");
const ca =
		process.env.DATABASE_CA_PEM || (await readFile(process.env.DATABASE_CA_FILE, "utf8")),
	results = [],
	values = [];
for (const [key, env, role, channel] of [
	["EVENT_DATABASE_URL", "DATABASE_URL", "partmeasure_runtime", "pm_project_events"],
	["WORKER_EVENT_DATABASE_URL", "WORKER_DATABASE_URL", "partmeasure_worker", "pm_file_jobs"],
]) {
	const url = new URL(process.env[env]);
	if (!decodeURIComponent(url.username).startsWith(`${role}.rvysclscetfqicpnzlra`))
		throw Error("WRONG_ROLE");
	url.port = "5432";
	url.searchParams.delete("sslmode");
	const client = new pg.Client({
		connectionString: url.href,
		ssl: { rejectUnauthorized: true, ca },
		connectionTimeoutMillis: 10000,
		query_timeout: 10000,
	});
	try {
		await client.connect();
		if ((await client.query("select current_user as role")).rows[0]?.role !== role)
			throw Error("WRONG_ROLE");
		await client.query(`listen ${channel}`);
		await client.query(`unlisten ${channel}`);
		values.push(`${key}=${url.href}`);
		results.push({ role, status: "PASS", mode: "session-pooler-5432-verified-TLS" });
	} catch (e) {
		const reasons = [
			["capacity", /max.*client|too many|pool.*size/i],
			["credentials", /password authentication|wrong password/i],
			["tenant", /tenant.*not found/i],
			["tls", /certificate|TLS|SSL/i],
			["timeout", /timeout|timed out/i],
			["terminated", /terminated|closed/i],
		];
		results.push({
			role,
			status: "FAIL",
			code: /^[A-Z0-9_]+$/.test(e.code ?? "") ? e.code : "CONNECT_FAILED",
			reason:
				reasons.find(([, pattern]) => pattern.test(e.message ?? ""))?.[0] ?? "unclassified",
		});
	} finally {
		await client.end().catch(() => {});
	}
}
await mkdir("tmp/performance-s34", { recursive: true });
await mkdir("docs/evidence/performance-s34", { recursive: true });
if (results.every((r) => r.status === "PASS"))
	await writeFile("tmp/performance-s34/events.env", `${values.join("\n")}\n`, { mode: 0o600 });
await writeFile(
	"docs/evidence/performance-s34/cloud-connections.json",
	JSON.stringify(
		{
			network: "development-machine direct; VPN/TUN not controlled; not mainland mobile",
			project: "rvysclscetfqicpnzlra",
			results,
		},
		null,
		2,
	),
);
console.log(JSON.stringify(results));
if (results.some((r) => r.status !== "PASS")) process.exitCode = 1;
