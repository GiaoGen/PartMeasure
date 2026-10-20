// One-time, manually invoked upgrade for existing annotations; no daemon or new network layer.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import pg from "pg";
import { syncAnnotationMeasurements } from "../../src/lib/server/annotation-collaboration";
import { transaction, getPool } from "../../src/lib/server/db";
import { access } from "../../src/lib/server/service";
const ref = "rvysclscetfqicpnzlra";
if (
	process.env.PM_NETWORK_MODE !== "direct" ||
	new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname !==
		`${ref}.supabase.co`
)
	throw Error("ISOLATED_ONLY");
const runtime = new URL(process.env.DATABASE_URL ?? "");
if (!runtime.username.endsWith(`.${ref}`)) throw Error("ISOLATED_ONLY");
const url = new URL(
	(await readFile("tmp/p0-1/admin-database-url.txt", "utf8")).trim(),
);
if (
	url.username !== `postgres.${ref}` ||
	!url.hostname.endsWith(".pooler.supabase.com")
)
	throw Error("ISOLATED_ONLY");
const password = decodeURIComponent(url.password);
if (password.startsWith("[") && password.endsWith("]"))
	url.password = encodeURIComponent(password.slice(1, -1));
url.searchParams.delete("sslmode");
const db = new pg.Client({
	connectionString: url.href,
	ssl: {
		rejectUnauthorized: true,
		ca: await readFile("tmp/p0-1/supabase-ca.crt", "utf8"),
	},
	connectionTimeoutMillis: 15000,
});
let processed = 0;
try {
	await db.connect();
	const { rows } = await db.query(
		"select a.id,a.project_id,p.owner_id from pm.annotations a join pm.projects p on p.id=a.project_id join pm.file_assets f on f.id=a.file_id and f.project_id=a.project_id where a.deleted_at is null and f.deleted_at is null and f.visibility='customer' and f.purpose='material' order by a.project_id,a.id limit 2001",
	);
	if (rows.length > 2000) throw Error("BATCH_LIMIT");
	for (const entry of rows) {
		const actor = { kind: "owner" as const, id: entry.owner_id };
		await transaction(actor, async (client) => {
			await access(client, actor, entry.project_id, true);
			const a = (
				await client.query(
					"select * from pm.annotations where project_id=$1 and id=$2 and deleted_at is null for update",
					[entry.project_id, entry.id],
				)
			).rows[0];
			if (a)
				await syncAnnotationMeasurements(
					client,
					actor,
					entry.project_id,
					a.file_id,
					{ ...a, deleted: false },
				);
		});
		processed++;
	}
	await mkdir("docs/evidence/annotation-collaboration", { recursive: true });
	const report = {
		checkedAt: new Date().toISOString(),
		status: "PASS",
		projectRef: ref,
		processed,
		scope:
			"one-time runtime/RLS reconciliation; no annotation content/revisions rewritten",
	};
	await writeFile(
		"docs/evidence/annotation-collaboration/reconcile.json",
		`${JSON.stringify(report, null, 2)}\n`,
	);
	console.log(JSON.stringify(report));
} catch (e) {
	console.error(
		JSON.stringify({
			status: "FAIL",
			code: /^[A-Z0-9_]+$/.test((e as { code?: string }).code ?? "")
				? (e as { code: string }).code
				: "RECONCILE_FAILED",
			processed,
		}),
	);
	process.exitCode = 1;
} finally {
	await db.end();
	await getPool().end();
}
