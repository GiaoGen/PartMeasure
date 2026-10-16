// Structural checks using controlled rollback fixtures; not a substitute for real Auth/API tests.
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";
const fixture = JSON.parse(await readFile("tmp/p0-2/fixture.json", "utf8")),
	results = [];
const admin = new URL(
	(await readFile("tmp/p0-1/admin-database-url.txt", "utf8")).trim(),
);
if (!admin.username.endsWith(".rvysclscetfqicpnzlra"))
	throw new Error("WRONG_TEST_PROJECT");
const pass = decodeURIComponent(admin.password);
if (pass.startsWith("[") && pass.endsWith("]"))
	admin.password = encodeURIComponent(pass.slice(1, -1));
const runtime = new URL(process.env.DATABASE_URL);
admin.searchParams.delete("sslmode");
runtime.searchParams.delete("sslmode");
const ssl = {
	rejectUnauthorized: true,
	ca: await readFile(process.env.DATABASE_CA_FILE, "utf8"),
};
const db = new pg.Client({ connectionString: admin.href, ssl }),
	restricted = new pg.Client({ connectionString: runtime.href, ssl });
await db.connect();
await restricted.connect();
async function check(name, work) {
	try {
		await work();
		results.push({ check: name, status: "PASS" });
	} catch {
		results.push({ check: name, status: "FAIL" });
	}
	process.stdout.write(`${name}: ${results.at(-1).status}\n`);
}
async function rejected(client, work, allowed = ["23514", "42501"]) {
	await client.query("begin");
	let code;
	try {
		await work();
	} catch (e) {
		code = e.code;
	} finally {
		await client.query("rollback");
	}
	assert.ok(allowed.includes(code));
}
try {
	const owner = (
		await db.query("select owner_id from pm.projects where id=$1", [
			fixture.projectA,
		])
	).rows[0].owner_id;
	const head = (
		await db.query("select * from pm.annotations where id=$1", [fixture.line])
	).rows[0];
	await check(
		"private-rls-no-browser-no-worker-no-history-update",
		async () => {
			const r = await db.query(
				"select bool_and(c.relrowsecurity) as rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pm' and c.relname=any($1)",
				[["annotations", "annotation_revisions", "issues"]],
			);
			assert.equal(r.rows[0].rls, true);
			for (const role of ["anon", "authenticated", "partmeasure_worker"])
				for (const table of ["annotations", "annotation_revisions", "issues"])
					assert.equal(
						(
							await db.query(
								"select has_table_privilege($1,$2,'select') as granted",
								[role, `pm.${table}`],
							)
						).rows[0].granted,
						false,
					);
			for (const table of ["annotations", "annotation_revisions", "issues"])
				assert.equal(
					(
						await db.query(
							"select has_table_privilege('partmeasure_runtime',$1,'delete') as granted",
							[`pm.${table}`],
						)
					).rows[0].granted,
					false,
				);
			assert.equal(
				(
					await db.query(
						"select has_table_privilege('partmeasure_runtime','pm.annotation_revisions','update') as granted",
					)
				).rows[0].granted,
				false,
			);
		},
	);
	await check("database-rejects-invalid-geometry-and-rebinding", async () => {
		await rejected(db, async () => {
			await db.query("select set_config('pm.owner_id',$1,true)", [owner]);
			await db.query(
				"update pm.annotations set geometry=$2,revision=revision+1 where id=$1",
				[head.id, JSON.stringify({ type: "point", at: { x: -0.1, y: 0.5 } })],
			);
		});
		await rejected(db, async () => {
			await db.query(
				"update pm.annotations set image_hash=$2,revision=revision+1 where id=$1",
				[head.id, "0".repeat(64)],
			);
		});
	});
	await check("canonical-image-dimensions-and-history-immutable", async () => {
		await rejected(db, () =>
			db.query("update pm.file_assets set width=width+1 where id=$1", [
				fixture.image,
			]),
		);
		await rejected(db, () =>
			db.query(
				"update pm.annotation_revisions set metadata=$2 where annotation_id=$1",
				[head.id, JSON.stringify({ source: "human", name: "forged" })],
			),
		);
		await rejected(db, () =>
			db.query("delete from pm.annotation_revisions where annotation_id=$1", [
				head.id,
			]),
		);
		assert.equal(
			(
				await db.query(
					"select history_protected from pm.file_assets where id=$1",
					[fixture.image],
				)
			).rows[0].history_protected,
			true,
		);
	});
	await check(
		"valid-guest-context-can-read-but-cannot-create-annotations",
		async () => {
			const hash = (
				await db.query(
					"select s.token_hash from pm.guest_sessions s join pm.share_links l on l.id=s.share_id where s.project_id=$1 and s.expires_at>now() and l.revoked_at is null and l.expires_at>now() limit 1",
					[fixture.projectA],
				)
			).rows[0].token_hash;
			await restricted.query("begin");
			try {
				await restricted.query(
					"select set_config('pm.owner_id','',true),set_config('pm.guest_hash',$1,true)",
					[hash],
				);
				assert.ok(
					(
						await restricted.query(
							"select id from pm.annotations where id=$1",
							[head.id],
						)
					).rowCount > 0,
				);
			} finally {
				await restricted.query("rollback");
			}
			await rejected(restricted, async () => {
				await restricted.query(
					"select set_config('pm.owner_id','',true),set_config('pm.guest_hash',$1,true)",
					[hash],
				);
				await restricted.query(
					"insert into pm.annotations(id,project_id,file_id,image_hash,normalization_version,geometry,metadata,revision) values($1,$2,$3,$4,1,$5,$6,1)",
					[
						randomUUID(),
						head.project_id,
						head.file_id,
						head.image_hash,
						JSON.stringify(head.geometry),
						JSON.stringify(head.metadata),
					],
				);
			});
		},
	);
	await check("formal-migration-source-matches-isolated-cloud", async () => {
		const history = (
			await db.query(
				"select version,name,statements from supabase_migrations.schema_migrations where name='p0_2_annotations_file_issues'",
			)
		).rows[0];
		const sql = (
			await readFile(
				`supabase/migrations/${history.version}_${history.name}.sql`,
				"utf8",
			)
		).trim();
		assert.equal(sql, history.statements.join("\n").trim());
		await writeFile(
			"docs/evidence/p0-2/migration.json",
			`${JSON.stringify({ projectRef: "rvysclscetfqicpnzlra", version: history.version, name: history.name, sha256: createHash("sha256").update(sql).digest("hex") }, null, 2)}\n`,
		);
	});
} finally {
	await db.end();
	await restricted.end();
}
await writeFile(
	"docs/evidence/p0-2/db.json",
	`${JSON.stringify({ checkedAt: new Date().toISOString(), structuralRollbackFixtures: true, results }, null, 2)}\n`,
);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
