// Real restricted-role and rollback checks. Every mutation is rolled back.
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";
const f = JSON.parse(await readFile("tmp/p0-4/fixture.json", "utf8")),
	results = [];
const adminUrl = new URL(
	(await readFile("tmp/p0-1/admin-database-url.txt", "utf8")).trim(),
);
if (!adminUrl.username.endsWith(".rvysclscetfqicpnzlra"))
	throw Error("WRONG_PROJECT");
const pass = decodeURIComponent(adminUrl.password);
if (pass.startsWith("[") && pass.endsWith("]"))
	adminUrl.password = encodeURIComponent(pass.slice(1, -1));
adminUrl.searchParams.delete("sslmode");
const runtime = new URL(process.env.DATABASE_URL);
runtime.searchParams.delete("sslmode");
const ssl = {
	rejectUnauthorized: true,
	ca: await readFile(process.env.DATABASE_CA_FILE, "utf8"),
};
const admin = new pg.Client({
		connectionString: adminUrl.href,
		ssl,
		connectionTimeoutMillis: 10000,
	}),
	db = new pg.Client({
		connectionString: runtime.href,
		ssl,
		connectionTimeoutMillis: 10000,
	});
await admin.connect();
await db.connect();
const workerUrl = new URL(process.env.WORKER_DATABASE_URL);
workerUrl.searchParams.delete("sslmode");
const worker = new pg.Client({
	connectionString: workerUrl.href,
	ssl,
	connectionTimeoutMillis: 10000,
});
await worker.connect();
async function check(name, work) {
	try {
		await work();
		results.push({ check: name, status: "PASS" });
	} catch (e) {
		results.push({
			check: name,
			status: "FAIL",
			code: /^[0-9A-Z]{5}$/.test(e.code ?? "") ? e.code : e.name,
		});
	}
	console.log(`${name}: ${results.at(-1).status}`);
}
async function rollback(work, expected) {
	await db.query("begin");
	let code;
	try {
		await work();
	} catch (e) {
		code = e.code;
	} finally {
		await db.query("rollback");
	}
	if (expected) assert.ok(expected.includes(code));
	else assert.equal(code, undefined);
}
try {
	const owner = (
		await admin.query("select owner_id from pm.projects where id=$1", [
			f.projectA,
		])
	).rows[0].owner_id;
	const ownerB = (
		await admin.query("select owner_id from pm.projects where id=$1", [
			f.projectB,
		])
	).rows[0].owner_id;
	const setOwner = () =>
		db.query(
			"select set_config('pm.owner_id',$1,true),set_config('pm.guest_hash','',true)",
			[owner],
		);
	await check("new-tables-RLS-and-minimal-grants", async () => {
		assert.equal(
			(
				await admin.query(
					"select bool_and(relrowsecurity) as ok from pg_class where oid in ('pm.deliveries'::regclass,'pm.delivery_files'::regclass)",
				)
			).rows[0].ok,
			true,
		);
		for (const table of ["deliveries", "delivery_files"])
			for (const role of ["anon", "authenticated", "partmeasure_worker"])
				assert.equal(
					(
						await admin.query(
							"select has_table_privilege($1,$2,'select,insert,update,delete') as granted",
							[role, `pm.${table}`],
						)
					).rows[0].granted,
					false,
				);
		assert.equal(
			(
				await admin.query(
					"select rolbypassrls or rolsuper as unsafe from pg_roles where rolname='partmeasure_runtime'",
				)
			).rows[0].unsafe,
			false,
		);
	});
	await check("Owner-B-RLS-cannot-read-A-deliveries", () =>
		rollback(async () => {
			await db.query(
				"select set_config('pm.owner_id',$1,true),set_config('pm.guest_hash','',true)",
				[ownerB],
			);
			assert.equal(
				(
					await db.query("select id from pm.deliveries where project_id=$1", [
						f.projectA,
					])
				).rowCount,
				0,
			);
		}),
	);
	await check("published-delivery-and-membership-immutable", async () => {
		await rollback(async () => {
			await setOwner();
			await db.query(
				"update pm.deliveries set description='overwrite',revision=revision+1 where id=$1",
				[f.delivery1],
			);
		}, ["23514"]);
		await rollback(async () => {
			await setOwner();
			await db.query(
				"update pm.delivery_files set selected=false where delivery_id=$1",
				[f.delivery1],
			);
		}, ["23514"]);
		await rollback(async () => {
			await setOwner();
			await db.query("delete from pm.deliveries where id=$1", [f.delivery1]);
		}, ["42501"]);
	});
	await check("published-underlying-file-immutable", async () => {
		await rollback(async () => {
			await setOwner();
			await db.query(
				"update pm.file_assets set filename='overwrite.step' where id=$1",
				[f.file1.id],
			);
		}, ["42501", "23514"]);
		await rollback(async () => {
			await setOwner();
			await db.query(
				"update pm.file_assets set visibility='internal' where id=$1",
				[f.file1.id],
			);
		}, ["23514"]);
	});
	await check(
		"publication-without-protection-rolls-back-whole-transaction",
		async () => {
			const id = randomUUID();
			await rollback(async () => {
				await db.query(
					"select set_config('pm.owner_id',$1,true),set_config('pm.guest_hash','',true)",
					[ownerB],
				);
				await db.query(
					"insert into pm.deliveries(id,project_id,created_by) values($1,$2,$3)",
					[id, f.projectB, ownerB],
				);
				await db.query(
					"insert into pm.delivery_files(project_id,delivery_id,file_id,position) values($1,$2,$3,1)",
					[f.projectB, id, f.otherFile.id],
				);
				await db.query(
					"update pm.deliveries set state='published',version_no=1,published_by=$2,published_at=now(),revision=2 where id=$1",
					[id, ownerB],
				);
				await db.query("set constraints all immediate");
			}, ["23514"]);
			assert.equal(
				(await admin.query("select id from pm.deliveries where id=$1", [id]))
					.rowCount,
				0,
			);
		},
	);
	await check(
		"empty-publication-cannot-commit-and-purpose-immutable",
		async () => {
			await rollback(async () => {
				await setOwner();
				const id = (
					await db.query(
						"insert into pm.deliveries(project_id,created_by) values($1,$2) returning id",
						[f.projectA, owner],
					)
				).rows[0].id;
				await db.query(
					"update pm.deliveries set state='published',version_no=(select max(version_no)+1 from pm.deliveries where project_id=$2),published_by=$3,published_at=now(),revision=2 where id=$1",
					[id, f.projectA, owner],
				);
				await db.query("set constraints all immediate");
			}, ["23514"]);
			await rollback(async () => {
				await setOwner();
				await db.query(
					"update pm.file_assets set purpose='material' where id=$1",
					[f.file1.id],
				);
			}, ["42501", "23514"]);
		},
	);
	await check(
		"worker-generic-plan-material-internal-guards-without-delivery-grants",
		async () => {
			for (const fileId of [f.material.id, f.otherFile.id]) {
				await worker.query("begin");
				await worker.query("set local plan_cache_mode=force_generic_plan");
				let code;
				try {
					await worker.query(
						"insert into pm.file_assets select * from pm.file_assets where id=$1",
						[fileId],
					);
				} catch (e) {
					code = e.code;
				} finally {
					await worker.query("rollback");
				}
				// Duplicate id is expected only after the purpose guard permits the insert.
				assert.equal(code, "23505");
			}
		},
	);
	await check("cloud-migration-exact-source-match", async () => {
		const m = (
			await admin.query(
				"select version,name,statements from supabase_migrations.schema_migrations where name in ('p0_4_deliveries','p0_4_worker_purpose_guard') order by version",
			)
		).rows;
		assert.equal(m.length, 2);
		const evidence = [];
		for (const migration of m) {
			const sql = (
				await readFile(
					`supabase/migrations/${migration.version}_${migration.name}.sql`,
					"utf8",
				)
			)
				.replace(/\r\n/g, "\n")
				.trim();
			assert.equal(
				sql,
				migration.statements.join("\n").replace(/\r\n/g, "\n").trim(),
			);
			evidence.push({
				projectRef: "rvysclscetfqicpnzlra",
				version: migration.version,
				name: migration.name,
				sha256: createHash("sha256").update(sql).digest("hex"),
				sourceMatch: true,
			});
		}
		await writeFile(
			"docs/evidence/p0-4/migration.json",
			`${JSON.stringify(evidence, null, 2)}\n`,
		);
	});
} finally {
	await db.end();
	await admin.end();
	await worker.end();
}
await writeFile(
	"docs/evidence/p0-4/db.json",
	`${JSON.stringify({ checkedAt: new Date().toISOString(), realDatabase: true, rollbackOnly: true, results }, null, 2)}\n`,
);
if (results.some((x) => x.status === "FAIL")) process.exitCode = 1;
