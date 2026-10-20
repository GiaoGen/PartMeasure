// Only the already-authorized isolated project. No password in argv/output/history.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
const ref = "rvysclscetfqicpnzlra",
	version = "20261020073647",
	name = "annotation_collaboration";
let db;
try {
	if (
		process.env.PM_NETWORK_MODE !== "direct" ||
		new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !==
			`${ref}.supabase.co`
	)
		throw Error("WRONG_PROJECT");
	const url = new URL(
		(await readFile("tmp/p0-1/admin-database-url.txt", "utf8")).trim(),
	);
	if (
		url.username !== `postgres.${ref}` ||
		!url.hostname.endsWith(".pooler.supabase.com")
	)
		throw Error("WRONG_DATABASE");
	const password = decodeURIComponent(url.password);
	if (
		password.startsWith("[") &&
		password.endsWith("]") &&
		password !== "[YOUR-PASSWORD]"
	)
		url.password = encodeURIComponent(password.slice(1, -1));
	url.searchParams.delete("sslmode");
	const sql = await readFile(
			`supabase/migrations/${version}_${name}.sql`,
			"utf8",
		),
		sha256 = createHash("sha256").update(sql).digest("hex");
	db = new pg.Client({
		connectionString: url.href,
		ssl: {
			rejectUnauthorized: true,
			ca: await readFile("tmp/p0-1/supabase-ca.crt", "utf8"),
		},
		connectionTimeoutMillis: 15000,
	});
	await db.connect();
	await db.query("begin");
	await db.query(
		"set local log_statement='none';set local log_min_error_statement='panic';set local log_parameter_max_length=0;set local log_parameter_max_length_on_error=0",
	);
	await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
		`migration:${name}`,
	]);
	const previous = await db.query(
		"select version,statements from supabase_migrations.schema_migrations where version=$1 or name=$2",
		[version, name],
	);
	if (previous.rows.length) {
		if (
			previous.rows.length !== 1 ||
			previous.rows[0].version !== version ||
			createHash("sha256")
				.update(previous.rows[0].statements.join("\n"))
				.digest("hex") !== sha256
		)
			throw Error("MIGRATION_CONFLICT");
	} else {
		await db.query(sql);
		await db.query(
			"insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)",
			[version, name, [sql]],
		);
	}
	await db.query("commit");
	const report = {
		checkedAt: new Date().toISOString(),
		projectRef: ref,
		version,
		name,
		sha256,
		status: "PASS",
		replay: previous.rows.length > 0,
		scope: "isolated test migration only; no production or stand-ins",
	};
	await mkdir("docs/evidence/annotation-collaboration", { recursive: true });
	await writeFile(
		"docs/evidence/annotation-collaboration/migration.json",
		`${JSON.stringify(report, null, 2)}\n`,
	);
	console.log(JSON.stringify(report));
} catch (e) {
	await db?.query("rollback").catch(() => {});
	console.error(
		JSON.stringify({
			status: "FAIL",
			code: /^[A-Z0-9_]+$/.test(e.code ?? "")
				? e.code
				: "ISOLATED_MIGRATION_FAILED",
		}),
	);
	process.exitCode = 1;
} finally {
	await db?.end().catch(() => {});
}
