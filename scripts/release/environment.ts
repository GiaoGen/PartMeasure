// Strictly read-only control-plane fallback when the connector transport is unavailable.
import nextEnv from "@next/env";
import pg from "pg";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { connectionFailure, connectionTarget, isolatedRef } from "../maintenance/connection-model";
import { sha256 } from "./fingerprint";
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
connectionTarget(process.env);
const url = new URL((await readFile("tmp/p0-1/admin-database-url.txt", "utf8")).trim());
if (url.username !== `postgres.${isolatedRef}` || !/^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) || !["5432", "6543"].includes(url.port) || url.pathname !== "/postgres") throw Error("ISOLATED_INSPECTOR_ONLY");
const password = decodeURIComponent(url.password);
if (password.startsWith("[") && password.endsWith("]")) url.password = encodeURIComponent(password.slice(1, -1));
url.searchParams.delete("sslmode");
const client = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: true, ca: await readFile(process.env.DATABASE_CA_FILE ?? "", "utf8") }, connectionTimeoutMillis: 10000, query_timeout: 15000 });
client.on("error", () => {});
let phase = "connect";
const evidence: Record<string, unknown> = { checkedAt: new Date().toISOString(), project: isolatedRef, scope: "Admin read-only metadata; never ordinary-role acceptance, no business writes/config changes" };
try {
	await client.connect(); await client.query("begin read only"); phase = "migration_inventory";
	const applied = (await client.query("select version,name from supabase_migrations.schema_migrations order by version")).rows as { version: string; name: string }[];
	const local = (await readdir("supabase/migrations")).filter(x => x.endsWith(".sql")).map(x => ({ version: x.split("_")[0], filename: x }));
	evidence.migrations = { applied, local, missing: local.filter(x => !applied.some(a => a.version === x.version)), remoteOnly: applied.filter(a => !local.some(x => x.version === a.version)) };
	// Earlier MCP apply generated new timestamps. Compare statements, never replay them.
	const equivalence = [];
	for (const [localVersion, remoteVersion] of [["20261019082939", "20261019085929"], ["20261019093029", "20261019093322"]]) {
		const file = local.find(x => x.version === localVersion);
		if (!file) throw Error("MIGRATION_MAPPING_INVALID");
		const remote = (await client.query("select statements from supabase_migrations.schema_migrations where version=$1", [remoteVersion])).rows[0]?.statements as string[] | undefined;
		if (!remote) throw Error("MIGRATION_MAPPING_INVALID");
		const normalize = (sql: string) => sql.replaceAll("\r\n", "\n").trim().replace(/;+$/, "");
		const localSql = normalize(await readFile(`supabase/migrations/${file.filename}`, "utf8"));
		const remoteSql = normalize(remote.join("\n"));
		equivalence.push({ localVersion, remoteVersion, localSha256: sha256(localSql), remoteSha256: sha256(remoteSql), exactNormalizedMatch: localSql === remoteSql });
		await writeFile(`tmp/p3-05/migration-${remoteVersion}.sql`, remote.join("\n"));
	}
	evidence.migrationEquivalence = equivalence;
	phase = "security_metadata";
	evidence.roles = (await client.query("select rolname,rolsuper,rolbypassrls,rolinherit,rolcanlogin from pg_roles where rolname in ('partmeasure_runtime','partmeasure_worker') order by rolname")).rows;
	evidence.buckets = (await client.query("select count(*)::int as total,count(*) filter(where public)::int as public from storage.buckets")).rows[0];
	await client.query("rollback"); evidence.status = "PASS";
} catch (error) { evidence.status = "NOT_PASSED"; evidence.failure = { phase, ...connectionFailure(error) }; process.exitCode = 1; }
finally { await client.end().catch(() => {}); }
await writeFile("docs/evidence/p3-05/environment.json", `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
