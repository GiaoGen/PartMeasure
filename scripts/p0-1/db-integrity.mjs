// Structural DB/fixture checks. These do not substitute for HTTP Auth/RLS tests.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import pg from "pg";
import { request } from "@playwright/test";
const fixture = JSON.parse(
		await readFile("tmp/p0-1/business-fixtures.json", "utf8"),
	),
	results = [];
const adminUrl = new URL(
	(await readFile("tmp/p0-1/admin-database-url.txt", "utf8")).trim(),
);
if (!adminUrl.username.endsWith(".rvysclscetfqicpnzlra"))
	throw new Error("WRONG_TEST_PROJECT");
const password = decodeURIComponent(adminUrl.password);
if (password.startsWith("[") && password.endsWith("]"))
	adminUrl.password = encodeURIComponent(password.slice(1, -1));
adminUrl.searchParams.delete("sslmode");
const ssl = {
	rejectUnauthorized: true,
	ca: await readFile(process.env.DATABASE_CA_FILE, "utf8"),
};
const db = new pg.Client({ connectionString: adminUrl.href, ssl });
await db.connect();
const client = await request.newContext({
	baseURL: "http://127.0.0.1:3000",
	storageState: "tmp/p0-1/owner-A.json",
});
async function check(name, work) {
	try {
		await work();
		results.push({ check: name, status: "PASS" });
	} catch {
		results.push({ check: name, status: "FAIL" });
	}
	process.stdout.write(`${name}: ${results.at(-1).status}\n`);
}
async function write(url, method, data) {
	const csrf = await (await client.get("/api/csrf")).json();
	return client.fetch(url, {
		method,
		data,
		headers: {
			origin: "http://127.0.0.1:3000",
			"x-csrf-token": csrf.data.token,
			"Idempotency-Key": randomUUID(),
		},
	});
}
try {
	await check(
		"runtime-worker-not-owner-not-bypass-and-no-browser-schema-grant",
		async () => {
			const { rows } = await db.query(
				"select rolname,rolsuper,rolbypassrls,rolinherit from pg_roles where rolname in ('partmeasure_runtime','partmeasure_worker')",
			);
			assert.equal(rows.length, 2);
			assert.ok(
				rows.every((r) => !r.rolsuper && !r.rolbypassrls && !r.rolinherit),
			);
			const browser = await db.query(
				"select has_schema_privilege('anon','pm','usage') or has_schema_privilege('authenticated','pm','usage') as exposed",
			);
			assert.equal(browser.rows[0].exposed, false);
			const rls = await db.query(
				"select bool_and(c.relrowsecurity and pg_get_userbyid(c.relowner) not in ('partmeasure_runtime','partmeasure_worker')) as safe from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pm' and c.relkind='r'",
			);
			assert.equal(rls.rows[0].safe, true);
		},
	);
	await check("history-protection-through-HTTP-and-DB-trigger", async () => {
		await db.query(
			"update pm.file_assets set history_protected=true where id=$1 and project_id=$2",
			[fixture.ownerFile, fixture.projectA],
		);
		try {
			assert.equal(
				(
					await write(
						`/api/projects/${fixture.projectA}/files/${fixture.ownerFile}`,
						"DELETE",
					)
				).status(),
				409,
			);
			await db.query("begin");
			let refused = false;
			try {
				await db.query(
					"update pm.file_assets set deleted_at=now() where id=$1",
					[fixture.ownerFile],
				);
			} catch (e) {
				refused = e.code === "23514";
			}
			await db.query("rollback");
			assert.ok(refused);
		} finally {
			await db.query(
				"update pm.file_assets set history_protected=false where id=$1",
				[fixture.ownerFile],
			);
		}
	});
	await check("immutable-storage-path-trigger", async () => {
		await db.query("begin");
		let refused = false;
		try {
			await db.query(
				"update pm.file_assets set storage_key='forbidden-replacement' where id=$1",
				[fixture.ownerFile],
			);
		} catch {
			refused = true;
		}
		await db.query("rollback");
		assert.ok(refused);
	});
	await check("quota-counters-match-retained-assets-and-inflight", async () => {
		const { rows } = await db.query(
			"select count(*)::int as mismatches from pm.owner_usage u where used_bytes<>(select coalesce(sum(used_bytes),0) from pm.projects where owner_id=u.owner_id) or reserved_bytes<>(select coalesce(sum(r.reserved_bytes),0) from pm.upload_reservations r join pm.projects p on p.id=r.project_id where p.owner_id=u.owner_id and r.state not in ('ready','cleaned'))",
		);
		assert.equal(rows[0].mismatches, 0);
		const deleted = await db.query(
			"select count(*)::int as n from pm.file_assets where project_id=$1 and deleted_at is not null",
			[fixture.projectA],
		);
		assert.ok(deleted.rows[0].n > 0);
	});
	await check(
		"transaction-identity-does-not-leak-after-commit-or-rollback",
		async () => {
			const c = new pg.Client({
				connectionString: process.env.DATABASE_URL,
				ssl,
			});
			await c.connect();
			try {
				const me = await (await client.get("/api/auth/session")).json();
				await c.query("begin");
				await c.query("select set_config('pm.owner_id',$1,true)", [me.data.id]);
				assert.equal(
					(
						await c.query(
							"select count(*)::int as n from pm.projects where id=$1",
							[fixture.projectA],
						)
					).rows[0].n,
					1,
				);
				await c.query("commit");
				assert.equal(
					(await c.query("select count(*)::int as n from pm.projects")).rows[0]
						.n,
					0,
				);
				await c.query("begin");
				await c.query("select set_config('pm.owner_id',$1,true)", [me.data.id]);
				await c.query("rollback");
				assert.equal(
					(await c.query("select count(*)::int as n from pm.projects")).rows[0]
						.n,
					0,
				);
			} finally {
				await c.end();
			}
		},
	);
	await check("applied-migration-source-matches-local-SQL", async () => {
		const history = await db.query(
			"select version,name,statements from supabase_migrations.schema_migrations where name like 'p0_1_%' order by version",
		);
		const files = await readdir("supabase/migrations");
		const records = [];
		for (const row of history.rows) {
			const name = `${row.version}_${row.name}.sql`;
			assert.ok(files.includes(name));
			const local = (
				await readFile(`supabase/migrations/${name}`, "utf8")
			).trim();
			const cloud = row.statements.join("\n").trim();
			assert.equal(local, cloud);
			records.push({
				version: row.version,
				name: row.name,
				sha256: createHash("sha256").update(local).digest("hex"),
			});
		}
		await writeFile(
			"docs/evidence/p0-1/migrations.json",
			JSON.stringify(
				{
					checkedAt: new Date().toISOString(),
					projectRef: "rvysclscetfqicpnzlra",
					records,
				},
				null,
				2,
			),
		);
	});
	await check("orphan-cleanup-never-issued-grant-fixture", async () => {
		const bytes = Buffer.from(randomUUID());
		const reserved = await write(
			`/api/projects/${fixture.projectA}/uploads`,
			"POST",
			{
				filename: "never-issued.step",
				byteSize: bytes.length,
				declaredMime: "application/octet-stream",
				sha256: createHash("sha256").update(bytes).digest("hex"),
			},
		);
		assert.equal(reserved.status(), 201);
		const id = (await reserved.json()).data.id;
		// No grant endpoint is called for this fixture; no live capability is shortened.
		await db.query(
			"update pm.upload_reservations set cleanup_after=now()-interval '1 minute',grant_expires_at=now()-interval '2 minutes' where id=$1 and state='reserved'",
			[id],
		);
		await new Promise((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[
					"--use-env-proxy",
					"--env-file=.env.local",
					"--conditions=react-server",
					"--import",
					"tsx",
					"scripts/p0-1/worker.ts",
					"--cleanup-only",
				],
				{ windowsHide: true, stdio: "ignore" },
			);
			child.once("error", reject);
			child.once("exit", (exit) =>
				exit === 0 ? resolve() : reject(new Error("CLEANUP_FAILED")),
			);
		});
		const state = await db.query(
			"select state from pm.upload_reservations where id=$1",
			[id],
		);
		assert.equal(state.rows[0].state, "cleaned");
	});
} finally {
	await client.dispose();
	await db.end();
}
await writeFile(
	"docs/evidence/p0-1/db-integrity.json",
	`${JSON.stringify({ checkedAt: new Date().toISOString(), structuralFixtureTests: true, notAuthAcceptance: true, results }, null, 2)}\n`,
);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
