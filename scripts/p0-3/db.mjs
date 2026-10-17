// Structural/transaction rollback checks complement normal Auth/API tests. No persisted test mutations.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";
const f = JSON.parse(await readFile("tmp/p0-3/fixture.json", "utf8")),
	results = [];
const url = new URL(
	(await readFile("tmp/p0-1/admin-database-url.txt", "utf8")).trim(),
);
if (!url.username.endsWith(".rvysclscetfqicpnzlra"))
	throw Error("WRONG_TEST_PROJECT");
const pass = decodeURIComponent(url.password);
if (pass.startsWith("[") && pass.endsWith("]"))
	url.password = encodeURIComponent(pass.slice(1, -1));
url.searchParams.delete("sslmode");
const runtime = new URL(process.env.DATABASE_URL);
runtime.searchParams.delete("sslmode");
const ssl = {
	rejectUnauthorized: true,
	ca: await readFile(process.env.DATABASE_CA_FILE, "utf8"),
};
const admin = new pg.Client({ connectionString: url.href, ssl }),
	db = new pg.Client({ connectionString: runtime.href, ssl });
await admin.connect();
await db.connect();
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
		await admin.query("select owner_id from pm.projects where id=$1", [
			f.projectA,
		])
	).rows[0].owner_id;
	const guest = (
		await admin.query(
			"select s.id,s.token_hash from pm.guest_sessions s join pm.share_links l on l.id=s.share_id where s.project_id=$1 and s.expires_at>now() and l.revoked_at is null and l.expires_at>now() order by s.created_at desc limit 1",
			[f.projectA],
		)
	).rows[0];
	const original = (
		await admin.query(
			"select id from pm.issue_responses where project_id=$1 and issue_id=$2 order by created_at limit 1",
			[f.projectA, f.p03.numeric],
		)
	).rows[0].id;
	await check(
		"private-new-tables-rls-and-no-browser-worker-history-mutation-grants",
		async () => {
			const tables = [
				"issue_responses",
				"response_attachments",
				"issue_reviews",
			];
			assert.equal(
				(
					await admin.query(
						"select bool_and(c.relrowsecurity) as enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pm' and c.relname=any($1)",
						[tables],
					)
				).rows[0].enabled,
				true,
			);
			for (const table of tables) {
				for (const role of ["anon", "authenticated", "partmeasure_worker"])
					assert.equal(
						(
							await admin.query(
								"select has_table_privilege($1,$2,'select') as granted",
								[role, `pm.${table}`],
							)
						).rows[0].granted,
						false,
					);
				for (const action of ["update", "delete"])
					assert.equal(
						(
							await admin.query(
								"select has_table_privilege($1,$2,$3) as granted",
								["partmeasure_runtime", `pm.${table}`, action],
							)
						).rows[0].granted,
						false,
					);
			}
		},
	);
	await check(
		"guest-valid-read-but-direct-review-status-and-asset-forgery-rejected",
		async () => {
			await db.query("begin");
			try {
				await db.query(
					"select set_config('pm.owner_id','',true),set_config('pm.guest_hash',$1,true)",
					[guest.token_hash],
				);
				assert.ok(
					(
						await db.query("select id from pm.issues where id=$1", [
							f.p03.numeric,
						])
					).rowCount > 0,
				);
				assert.ok(
					(
						await db.query("select id from pm.issue_responses where id=$1", [
							original,
						])
					).rowCount > 0,
				);
			} finally {
				await db.query("rollback");
			}
			await rejected(db, async () => {
				await db.query(
					"select set_config('pm.owner_id','',true),set_config('pm.guest_hash',$1,true)",
					[guest.token_hash],
				);
				await db.query(
					"update pm.issues set state='confirmed',revision=revision+1 where id=$1",
					[f.p03.negative],
				);
			});
			await rejected(db, async () => {
				await db.query(
					"select set_config('pm.owner_id','',true),set_config('pm.guest_hash',$1,true)",
					[guest.token_hash],
				);
				await db.query(
					"insert into pm.issue_reviews(project_id,issue_id,response_id,issue_revision,decision,source,value,unit,created_by) values($1,$2,$3,2,'confirm','customer_numeric','12.345','mm',$4)",
					[f.projectA, f.p03.numeric, original, owner],
				);
			});
			await rejected(db, async () => {
				await db.query(
					"select set_config('pm.owner_id','',true),set_config('pm.guest_hash',$1,true)",
					[guest.token_hash],
				);
				await db.query(
					"update pm.file_assets set filename='forged' where id=$1",
					[f.exif],
				);
			});
		},
	);
	await check(
		"immutable-request-snapshot-response-review-and-attachment-history",
		async () => {
			await rejected(admin, () =>
				admin.query(
					"update pm.issues set annotation_snapshot='{}'::jsonb,revision=revision+1 where id=$1",
					[f.p03.numeric],
				),
			);
			await rejected(admin, () =>
				admin.query("update pm.issue_responses set value='999' where id=$1", [
					original,
				]),
			);
			await rejected(admin, () =>
				admin.query(
					"delete from pm.issue_reviews where project_id=$1 and issue_id=$2",
					[f.projectA, f.p03.numeric],
				),
			);
			await rejected(admin, () =>
				admin.query(
					"delete from pm.response_attachments where response_id=$1",
					[original],
				),
			);
			await rejected(admin, () =>
				admin.query(
					"update pm.file_assets set history_protected=false where id=$1",
					[f.exif],
				),
			);
		},
	);
	await check(
		"response-requires-state-change-in-same-transaction",
		async () => {
			await rejected(db, async () => {
				await db.query(
					"select set_config('pm.owner_id',$1,true),set_config('pm.guest_hash','',true)",
					[owner],
				);
				await db.query(
					"insert into pm.issue_responses(project_id,issue_id,issue_revision,kind,value,unit,body,author_type,owner_id) values($1,$2,1,'numeric','5','mm','','owner',$3)",
					[f.projectA, f.p03.negative, owner],
				);
				await db.query("set constraints all immediate");
			});
			assert.equal(
				(
					await admin.query(
						"select count(*)::int as n from pm.issue_responses where issue_id=$1",
						[f.p03.negative],
					)
				).rows[0].n,
				0,
			);
		},
	);
	await check("no-late-evidence-attachment-to-committed-response", async () => {
		await rejected(db, async () => {
			await db.query(
				"select set_config('pm.owner_id',$1,true),set_config('pm.guest_hash','',true)",
				[owner],
			);
			await db.query(
				"insert into pm.response_attachments(project_id,issue_id,response_id,file_id) values($1,$2,$3,$4)",
				[f.projectA, f.p03.numeric, original, f.image],
			);
		});
	});
	await check("review-requires-head-state-in-same-transaction", async () => {
		await rejected(db, async () => {
			await db.query("select set_config('pm.owner_id',$1,true),set_config('pm.guest_hash','',true)", [owner]);
			const r = (await db.query("insert into pm.issue_responses(project_id,issue_id,issue_revision,kind,value,unit,body,author_type,owner_id) values($1,$2,1,'numeric','5','mm','','owner',$3) returning id", [f.projectA,f.p03.negative,owner])).rows[0];
			await db.query("update pm.issues set state='submitted',revision=2,latest_response_id=$2 where id=$1", [f.p03.negative,r.id]);
			await db.query("insert into pm.issue_reviews(project_id,issue_id,response_id,issue_revision,decision,value,unit,source,note,created_by) values($1,$2,$3,2,'confirm','5','mm','customer_numeric','',$4)", [f.projectA,f.p03.negative,r.id,owner]);
			await db.query("set constraints all immediate");
		});
		assert.equal((await admin.query("select state from pm.issues where id=$1", [f.p03.negative])).rows[0].state, "awaiting_response");
		assert.equal((await admin.query("select count(*)::int as n from pm.issue_reviews where issue_id=$1", [f.p03.negative])).rows[0].n, 0);
	});
	await check("formal-migration-cloud-and-local-source-match", async () => {
		const migrations = (
			await admin.query(
				"select version,name,statements from supabase_migrations.schema_migrations where name in ('p0_3_measurement_workflow','p0_3_issue_response_index') order by version",
			)
		).rows;
		assert.equal(migrations.length, 2);
		const evidence = [];
		for (const m of migrations) {
		const sql = (
			await readFile(`supabase/migrations/${m.version}_${m.name}.sql`, "utf8")
		)
			.replace(/\r\n/g, "\n")
			.trim();
		assert.equal(sql, m.statements.join("\n").replace(/\r\n/g, "\n").trim());
		evidence.push({ projectRef: "rvysclscetfqicpnzlra", version: m.version, name: m.name, sha256: createHash("sha256").update(sql).digest("hex") });
		}
		await writeFile(
			"docs/evidence/p0-3/migration.json",
			`${JSON.stringify(evidence, null, 2)}\n`,
		);
	});
} finally {
	await admin.end();
	await db.end();
}
await writeFile(
	"docs/evidence/p0-3/db.json",
	`${JSON.stringify({ checkedAt: new Date().toISOString(), realDatabase: true, structuralRollbackFixtures: true, results }, null, 2)}\n`,
);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
