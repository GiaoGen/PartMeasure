// Real isolated cloud database, minimal-role checks and rollback-only probes.
import pg from "pg";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const fixture = JSON.parse(
	await readFile("tmp/backend-alignment/api-fixture.json", "utf8"),
);
const adminUrl = new URL(
	(await readFile("tmp/p0-1/admin-database-url.txt", "utf8")).trim(),
);
const runtimeUrl = new URL(process.env.DATABASE_URL);
if (
	!adminUrl.username.endsWith(".rvysclscetfqicpnzlra") ||
	!runtimeUrl.username.endsWith(".rvysclscetfqicpnzlra")
)
	throw Error("WRONG_TEST_PROJECT");
const password = decodeURIComponent(adminUrl.password);
if (password.startsWith("[") && password.endsWith("]"))
	adminUrl.password = encodeURIComponent(password.slice(1, -1));
adminUrl.searchParams.delete("sslmode");
runtimeUrl.searchParams.delete("sslmode");
const ssl = {
	rejectUnauthorized: true,
	ca:
		process.env.DATABASE_CA_PEM ??
		(await readFile(process.env.DATABASE_CA_FILE, "utf8")),
};
const admin = new pg.Client({
	connectionString: adminUrl.href,
	ssl,
	connectionTimeoutMillis: 10000,
});
const db = new pg.Client({
	connectionString: runtimeUrl.href,
	ssl,
	connectionTimeoutMillis: 10000,
});
await admin.connect();
await db.connect();
const results = [],
	evidence = {};
async function check(name, work) {
	try {
		await work();
		results.push({ check: name, status: "PASS" });
	} catch (error) {
		results.push({
			check: name,
			status: "FAIL",
			code: /^[0-9A-Z_]+$/.test(error.code ?? "") ? error.code : error.name,
		});
	}
	process.stdout.write(`${name}: ${results.at(-1).status}\n`);
}
async function rollback(ownerId, work, expected) {
	await db.query("begin");
	let code;
	try {
		await db.query(
			"select set_config('pm.owner_id',$1,true),set_config('pm.guest_hash','',true)",
			[ownerId ?? ""],
		);
		await work();
	} catch (error) {
		code = error.code;
	} finally {
		await db.query("rollback");
	}
	assert.equal(code, expected);
}
try {
	const project = (
		await admin.query("select owner_id,name from pm.projects where id=$1", [
			fixture.projectId,
		])
	).rows[0];
	assert.ok(project.name.startsWith(fixture.prefix));
	const other = (
		await admin.query("select owner_id from pm.project_folders where id=$1", [
			fixture.folderB,
		])
	).rows[0].owner_id;
	await check(
		"migration-version-source-and-additive-schema-match",
		async () => {
			const cloud = (
				await admin.query(
					"select version,statements from supabase_migrations.schema_migrations where name='frontend_backend_alignment'",
				)
			).rows;
			assert.equal(cloud.length, 1);
			assert.equal(cloud[0].version, "20261019025932");
			const local = await readFile(
				"supabase/migrations/20261019025932_frontend_backend_alignment.sql",
				"utf8",
			);
			const normalizedHash = (s) =>
				createHash("sha256")
					.update(s.replaceAll("\r\n", "\n").trim())
					.digest("hex");
			evidence.migration = {
				version: cloud[0].version,
				localSha256: normalizedHash(local),
				cloudSha256: normalizedHash(cloud[0].statements.join("\n")),
			};
			assert.equal(
				evidence.migration.localSha256,
				evidence.migration.cloudSha256,
			);
			assert.equal(
				(
					await admin.query(
						"select relrowsecurity from pg_class where oid='pm.project_folders'::regclass",
					)
				).rows[0].relrowsecurity,
				true,
			);
		},
	);
	await check(
		"minimum-runtime-grants-and-no-browser-worker-access",
		async () => {
			for (const role of ["anon", "authenticated", "partmeasure_worker"])
				assert.equal(
					(
						await admin.query(
							"select has_table_privilege($1,'pm.project_folders','select,insert,update,delete') as allowed",
							[role],
						)
					).rows[0].allowed,
					false,
				);
			assert.equal(
				(
					await admin.query(
						"select has_table_privilege('partmeasure_runtime','pm.project_folders','update,delete') as allowed",
					)
				).rows[0].allowed,
				false,
			);
			assert.equal(
				(
					await admin.query(
						"select rolsuper or rolbypassrls as unsafe from pg_roles where rolname='partmeasure_runtime'",
					)
				).rows[0].unsafe,
				false,
			);
		},
	);
	await check("owner-B-and-Guest-RLS-cannot-see-A-folders", async () => {
		await rollback(other, async () =>
			assert.equal(
				(
					await db.query("select id from pm.project_folders where id=$1", [
						fixture.folderA,
					])
				).rowCount,
				0,
			),
		);
		await rollback(null, async () =>
			assert.equal(
				(await db.query("select id from pm.project_folders")).rowCount,
				0,
			),
		);
	});
	await check("cross-owner-project-folder-FK-rejects-and-rolls-back", () =>
		rollback(
			project.owner_id,
			() =>
				db.query("update pm.projects set folder_id=$2 where id=$1", [
					fixture.projectId,
					fixture.folderB,
				]),
			"23503",
		),
	);
	await check("Owner-folder-delete-and-update-are-not-granted", async () => {
		await rollback(
			project.owner_id,
			() =>
				db.query("delete from pm.project_folders where id=$1", [
					fixture.folderA,
				]),
			"42501",
		);
		await rollback(
			project.owner_id,
			() =>
				db.query("update pm.project_folders set color='blue' where id=$1", [
					fixture.folderA,
				]),
			"42501",
		);
	});
	await check(
		"database-format-and-owner-checks-cannot-be-bypassed",
		async () => {
			await rollback(
				project.owner_id,
				() =>
					db.query(
						"insert into pm.project_folders(owner_id,name,color) values($1,'invalid-color','yellow')",
						[project.owner_id],
					),
				"23514",
			);
			await rollback(
				project.owner_id,
				() =>
					db.query(
						"insert into pm.project_folders(owner_id,name,color) values($1,'全部','blue')",
						[project.owner_id],
					),
				"23514",
			);
			await rollback(
				other,
				() =>
					db.query(
						"insert into pm.project_folders(owner_id,name,color) values($1,'forged-owner','blue')",
						[project.owner_id],
					),
				"42501",
			);
		},
	);
	await check(
		"folder-count-query-plan-and-existing-private-buckets",
		async () => {
			await rollback(project.owner_id, async () => {
				const plan = (
					await db.query(
						"explain (format json) select id from pm.projects where owner_id=$1 and folder_id=$2 order by created_at desc,id desc limit 31",
						[project.owner_id, fixture.folderA],
					)
				).rows[0]["QUERY PLAN"][0].Plan;
				const summarize = (p) => ({
					type: p["Node Type"],
					...(p["Index Name"] ? { index: p["Index Name"] } : {}),
					...(p.Plans ? { children: p.Plans.map(summarize) } : {}),
				});
				evidence.folderPlan = summarize(plan);
			});
			assert.equal(
				(
					await admin.query(
						"select bool_and(not public) as private from storage.buckets where id in ('partmeasure-private','partmeasure-quarantine')",
					)
				).rows[0].private,
				true,
			);
		},
	);
} finally {
	await db.end();
	await admin.end();
	await mkdir("docs/evidence/backend-alignment", { recursive: true });
	await writeFile(
		"docs/evidence/backend-alignment/db.json",
		`${JSON.stringify({ checkedAt: new Date().toISOString(), projectRef: "rvysclscetfqicpnzlra", mutationScope: "rollback-only on ALIGN fixture", evidence, results }, null, 2)}\n`,
	);
}
if (results.some((r) => r.status !== "PASS")) process.exitCode = 1;
