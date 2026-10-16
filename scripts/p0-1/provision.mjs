// One-time local credential setup. No Auth Admin calls; no credentials in migration/history/output.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
const ref = "rvysclscetfqicpnzlra";
let stage = "read-config";
try {
	await mkdir("tmp/p0-1", { recursive: true });
	const config = JSON.parse(
		await readFile("tmp/p0-0-cloud/config.json", "utf8"),
	);
	const raw = (
		await readFile("tmp/p0-1/admin-database-url.txt", "utf8")
	).trim();
	const key = (await readFile("tmp/p0-1/secret-key.txt", "utf8")).trim();
	const url = new URL(raw);
	// Connect panel brackets are placeholder delimiters, not part of the supplied password.
	const suppliedPassword = decodeURIComponent(url.password);
	if (
		suppliedPassword.startsWith("[") &&
		suppliedPassword.endsWith("]") &&
		suppliedPassword !== "[YOUR-PASSWORD]"
	)
		url.password = encodeURIComponent(suppliedPassword.slice(1, -1));
	if (
		!decodeURIComponent(url.username).endsWith(`.${ref}`) ||
		!url.hostname.endsWith(".pooler.supabase.com") ||
		url.port !== "6543" ||
		!url.password ||
		url.password.includes("YOUR")
	)
		throw new Error("INVALID_TEST_POOLER_CONFIG");
	if (config.projectRef !== ref || !key.startsWith("sb_secret_"))
		throw new Error("INVALID_TEST_PROJECT_CONFIG");
	url.searchParams.delete("sslmode");
	stage = "connect";
	let ca;
	try {
		ca = await readFile("tmp/p0-1/supabase-ca.crt", "utf8");
	} catch {
		/* Verified public/system CA otherwise. */
	}
	const db = new pg.Client({
		connectionString: url.href,
		ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
		connectionTimeoutMillis: 15000,
	});
	await db.connect();
	try {
		await db.query("begin");
		stage = "disable-sensitive-statement-logging";
		await db.query("set local log_statement='none'");
		await db.query("set local log_min_error_statement='panic'");
		await db.query("set local log_parameter_max_length=0");
		await db.query("set local log_parameter_max_length_on_error=0");
		const runtimePassword = randomBytes(32).toString("base64url"),
			workerPassword = randomBytes(32).toString("base64url");
		stage = "set-role-passwords";
		await db.query(
			`alter role partmeasure_runtime password ${pg.escapeLiteral(runtimePassword)}`,
		);
		await db.query(
			`alter role partmeasure_worker password ${pg.escapeLiteral(workerPassword)}`,
		);
		const runtime = new URL(url),
			worker = new URL(url);
		runtime.username = `partmeasure_runtime.${ref}`;
		runtime.password = runtimePassword;
		worker.username = `partmeasure_worker.${ref}`;
		worker.password = workerPassword;
		const env = {
			APP_URL: "http://127.0.0.1:3000",
			NEXT_PUBLIC_SUPABASE_URL: config.url,
			NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
			SUPABASE_SECRET_KEY: key,
			DATABASE_URL: runtime.href,
			WORKER_DATABASE_URL: worker.href,
			SUPABASE_PROJECT_REF: ref,
			CLAMD_HOST: "",
			CLAMD_PORT: "3310",
			DATABASE_CA_FILE: ca ? "tmp/p0-1/supabase-ca.crt" : "",
		};
		await writeFile(
			"tmp/p0-1/generated-env.local",
			`${Object.entries(env)
				.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
				.join("\n")}\n`,
			{ mode: 0o600 },
		);
		await db.query("commit");
		// Never overwrite a user configuration. Caller reviews privately and copies only when no .env.local exists.
		process.stdout.write(
			"Runtime/worker credentials provisioned; ignored generated-env.local saved.\n",
		);
	} catch (error) {
		await db.query("rollback");
		throw error;
	} finally {
		await db.end();
	}
} catch (error) {
	const safeCode = /^[A-Z0-9_]{2,60}$/.test(error.code ?? "")
		? error.code
		: "REDACTED";
	process.stderr.write(`PROVISION_FAILED stage=${stage} code=${safeCode}\n`);
	if (stage === "connect")
		process.stderr.write(
			`reason=${/password authentication failed/i.test(error.message) ? "PASSWORD_REJECTED" : /tenant or user not found/i.test(error.message) ? "POOLER_TENANT_NOT_FOUND" : /timeout/i.test(error.message) ? "TIMEOUT" : "OTHER_REDACTED"}\n`,
		);
	process.exitCode = 1;
}
