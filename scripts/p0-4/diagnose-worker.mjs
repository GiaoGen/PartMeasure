import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
const u = new URL(process.env.WORKER_DATABASE_URL);
if (!u.username.endsWith(".rvysclscetfqicpnzlra")) throw Error("WRONG_PROJECT");
const p = decodeURIComponent(u.password);
if (p.startsWith("[") && p.endsWith("]"))
	u.password = encodeURIComponent(p.slice(1, -1));
u.searchParams.delete("sslmode");
const db = new pg.Client({
	connectionString: u.href,
	ssl: {
		rejectUnauthorized: true,
		ca: await readFile(process.env.DATABASE_CA_FILE, "utf8"),
	},
	connectionTimeoutMillis: 10000,
});
await db.connect();
let report;
try {
	const row = (
		await db.query(
			"select r.id from pm.upload_reservations r join pm.projects p on p.id=r.project_id where p.name like 'P0-4%' and r.error_code='PG_42501' and r.purpose='material' order by r.created_at desc limit 1",
		)
	).rows[0];
	if (!row) throw Error("NO_PENDING_FAILURE");
	await db.query("begin");
	try {
		await db.query(
			`insert into pm.file_assets(id,project_id,reservation_id,filename,mime,extension,byte_size,original_bytes,storage_key,original_key,sha256,original_sha256,width,height,normalization_version,uploader_type,purpose,visibility)
select r.id,r.project_id,r.id,r.filename,f.mime,r.extension,f.byte_size,f.original_bytes,r.project_id::text||'/'||r.id::text||'/canonical.webp',r.project_id::text||'/'||r.id::text||'/source',f.sha256,r.sha256,f.width,f.height,f.normalization_version,'owner','material','customer' from pm.upload_reservations r cross join lateral(select * from pm.file_assets where purpose='material' limit 1) f where r.id=$1`,
			[row.id],
		);
		report = { status: "NO_ERROR" };
	} catch (e) {
		report = {
			status: "REPRODUCED",
			code: e.code,
			relation: e.message.match(/(?:table|function) "?([a-z_.]+)/i)?.[1],
			phase: "rollback-worker-material-insert",
			constraint: e.constraint,
			classification: /^[A-Z_]{3,64}$/.test(e.message) ? e.message : undefined,
		};
	}
	await db.query("rollback");
} finally {
	await db.end();
}
await writeFile(
	"docs/evidence/p0-4/worker-permission-reproduction.json",
	`${JSON.stringify(report, null, 2)}\n`,
);
console.log(report);
