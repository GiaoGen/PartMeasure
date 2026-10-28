// Target-specific managed Supabase restore. Existing local-only restore is unchanged.
// Credentials are read from private files; no URLs, SQL data or tokens are logged.
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile, realpath } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import type pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { authenticatedBackup } from "../maintenance/restore";
import { backupKey } from "../maintenance/encrypted-file";
import { databaseClient } from "../maintenance/backup";
import { postgresTool, databaseFingerprints, cancelDatabaseOnAbort } from "../maintenance/postgres-tools";
import { privateDirectory } from "../maintenance/private-directory";
import { cloudTargetAllowed, cloudAuthTables, discardedAuthTables, userTokenColumns, recoveryIdentifier, recoveryInsert, decodeCopyField } from "../maintenance/cloud-recovery-model";

const configuration = z.object({ targetRef: z.string().regex(/^[a-z]{20}$/), databaseUrlFile: z.string().min(1), serviceKeyFile: z.string().min(1), publishableKeyFile: z.string().min(1), caFile: z.string().min(1), postgresBin: z.string().min(1) }).strict();
let phase = "configuration";
const counts = { objectsUploaded: 0, objectsVerified: 0, loginAttempts: 0 };
const signal = AbortSignal.timeout(2 * 60 * 60 * 1000);
const progress = setInterval(() => console.log(JSON.stringify({ event: "recovery_progress", phase, ...counts })), 20000); progress.unref();
const fileToolEnvironment: NodeJS.ProcessEnv = { NODE_ENV: "production", PGCLIENTENCODING: "UTF8", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
const query = async (db: pg.Client, text: string, values?: unknown[]) => { signal.throwIfAborted(); return db.query(text, values); };

async function dumpText(bin: string, dump: string, args: string[]) {
	const process = postgresTool(bin, "pg_restore", [...args, "--no-owner", "--no-acl", "--file=-", dump], fileToolEnvironment, signal);
	let text = "";
	try {
		for await (const chunk of process.output) { text += String(chunk); assert.ok(Buffer.byteLength(text) <= 4 * 1024 ** 2, "SCHEMA_OUTPUT_LIMIT"); }
		await process.done;
		return text.replace(/^\\(?:un)?restrict [A-Za-z0-9]+\r?\n/gm, "");
	} catch (error) { process.stop(); throw error; }
}
async function importData(db: pg.Client, bin: string, dump: string, schema: "pm" | "auth" | "supabase_migrations", allowed: Set<string>) {
	const args = ["--data-only", `--schema=${schema}`, ...(schema === "auth" ? cloudAuthTables.map(v => `--table=${v}`) : [])];
	const process = postgresTool(bin, "pg_restore", [...args, "--no-owner", "--no-acl", "--file=-", dump], fileToolEnvironment, signal);
	let current: { table: string; columns: string[] } | null = null, rows: (string | null)[][] = [], buffered = 0;
	const imported: Record<string, number> = {};
	const flush = async () => {
		assert.ok(current); if (!rows.length) return;
		const batch = recoveryInsert(schema, current.table, current.columns, rows);
		await query(db, batch.text, batch.values); rows = []; buffered = 0;
	};
	try {
		for await (const line of createInterface({ input: process.output, crlfDelay: Infinity })) {
			signal.throwIfAborted(); assert.ok(Buffer.byteLength(line) <= 4 * 1024 ** 2, "RECOVERY_ROW_LIMIT");
			if (current) {
				if (line === "\\.") { await flush(); current = null; continue; }
				const fields = line.split("\t"); assert.equal(fields.length, current.columns.length, "COPY_FIELD_COUNT_MISMATCH");
				rows.push(fields.map(decodeCopyField)); buffered += Buffer.byteLength(line);
				imported[current.table] = (imported[current.table] ?? 0) + 1;
				if (rows.length === 50 || buffered >= 512 * 1024) await flush();
				continue;
			}
			const copy = line.match(/^COPY ([a-z_]+)\.([a-z_]+) \(([^)]+)\) FROM stdin;$/);
			if (copy) {
				assert.equal(copy[1], schema); const table = copy[2], rawColumns = copy[3];
				assert.ok(table && rawColumns && allowed.has(table) && imported[table] === undefined, "UNAPPROVED_DUMP_TABLE");
				current = { table, columns: rawColumns.split(",").map(v => v.trim().replace(/^"|"$/g, "")) }; imported[table] = 0; continue;
			}
			const sequence = line.match(/^SELECT pg_catalog\.setval\('([a-z_]+)\.([a-z_]+)', (\d+), (true|false)\);$/);
			if (sequence) { assert.equal(sequence[1], schema); await query(db, "select pg_catalog.setval($1::regclass,$2::bigint,$3::boolean)", [`${sequence[1]}.${sequence[2]}`, sequence[3], sequence[4] === "true"]); continue; }
			assert.ok(!line.trim() || line.startsWith("--") || /^SET [a-z_]+ = [^;]+;$/.test(line) || /^SELECT pg_catalog\.set_config\('search_path', '', false\);$/.test(line) || /^\\(?:un)?restrict [A-Za-z0-9]+$/.test(line), "UNEXPECTED_DUMP_STATEMENT");
		}
		await process.done; assert.equal(current, null, "TRUNCATED_COPY_DATA");
		assert.deepEqual(Object.keys(imported).sort(), [...allowed].sort(), "MISSING_DUMP_TABLES"); return imported;
	} catch (error) { process.stop(); throw error; }
}

async function prepareOnly() {
	phase = "offline-import-parser";
	const copy = JSON.parse(await readFile("tmp/p3-05/recovery-drive-verified.json", "utf8"));
	const archive = JSON.parse(await readFile("tmp/p3-05/recovery-archive.json", "utf8"));
	const state = JSON.parse(await readFile(`tmp/fix-e/${archive.run}/state.json`, "utf8"));
	const key = await backupKey(path.join(path.dirname(state.environment.PM_BACKUP_KEY_FILE), "from-phone.backup-key"));
	let batches = 0;
	// Decoder preflight only: no database connection or SQL execution is represented.
	const sink = { query: async (text: string, values?: unknown[]) => {
		assert.ok(/^insert into "/.test(text) || text.startsWith("select pg_catalog.setval(")); assert.ok(values); batches++; return { rows: [] };
	} } as unknown as pg.Client;
	const workspace = path.resolve(`tmp/p3-05/recovery-import-preflight-${randomBytes(8).toString("hex")}`);
	try {
		await authenticatedBackup({ directory: copy.directory, workspace, key, signal }, async ({ manifest, staging }) => {
			const dump = path.join(staging, manifest.database.file), bin = state.environment.PM_POSTGRES_BIN;
			const authRows = await importData(sink, bin, dump, "auth", new Set(cloudAuthTables));
			const businessRows = await importData(sink, bin, dump, "pm", new Set(Object.keys(manifest.tables)));
			const historyRows = await importData(sink, bin, dump, "supabase_migrations", new Set(["schema_migrations"]));
			for (const [table, info] of Object.entries(manifest.tables)) assert.equal(businessRows[table], info.rows, "OFFLINE_ROW_COUNT_MISMATCH");
			assert.equal(authRows.users, 5); assert.equal(authRows.identities, 5); assert.equal(historyRows.schema_migrations, manifest.migrations.length);
			const historyDdl = await dumpText(bin, dump, ["--schema-only", "--schema=supabase_migrations"]); assert.ok(!/^\\/m.test(historyDdl), "PSQL_COMMAND_IN_HISTORY_DDL");
			const result = { checkedAt: new Date().toISOString(), status: "OFFLINE_IMPORT_PARSER_PASS_NOT_DATABASE_RESTORE", businessRows, authRows, historyRows, batches,
				allBusinessRowCountsMatch: true, managedAuthDdlExcluded: true, oldSessionsAndAmrClaimsSelected: false, cloudConnected: false, sqlExecuted: false };
			await writeFile("docs/evidence/p3-05/recovery-import-preflight.json", `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" }); console.log(JSON.stringify(result));
		});
	} finally { key.fill(0); }
}

async function main() {
	assert.equal(process.argv.length, 3, "REQUIRES_PRIVATE_CONFIGURATION_PATH"); const configFile = process.argv[2]; assert.ok(configFile);
	const configPath = await realpath(configFile);
	assert.ok(configPath.startsWith(`${path.resolve("tmp/p3-05")}${path.sep}`), "PRIVATE_CONFIGURATION_REQUIRED");
	const config = configuration.parse(JSON.parse(await readFile(configPath, "utf8")));
	const scope = JSON.parse(await readFile("docs/evidence/p3-05/recovery-cloud-scope.json", "utf8"));
	const created = JSON.parse(await readFile("tmp/p3-05/recovery-cloud-created.json", "utf8"));
	const copy = JSON.parse(await readFile("tmp/p3-05/recovery-drive-verified.json", "utf8"));
	const plan = JSON.parse(await readFile("docs/evidence/p3-05/recovery-cloud-plan.json", "utf8"));
	assert.equal(scope.status, "APPROVED"); assert.equal(created.id, config.targetRef);
	assert.equal(created.organization_id, scope.organization); assert.equal(created.region, scope.region);
	assert.equal(created.name, scope.projectName); assert.equal(created.createdForThisRun, true);
	assert.equal(scope.allowPaidUpgrade, false); assert.equal(scope.quotedMonthlyUsd, 0);
	assert.equal(copy.status, "PASS"); assert.equal(copy.phoneKeyCustodyVerified, true); assert.equal(copy.allDownloadedFilesGcmAndHashesAuthenticated, true);
	assert.equal(plan.sourceSet, scope.sourceSet);
	for (const [name, info] of Object.entries(plan.authTables) as [string, { rows: number }][]) {
		assert.ok(info.rows === 0 || cloudAuthTables.some(t => t === name) || discardedAuthTables.includes(name), "UNSUPPORTED_PERSISTENT_AUTH_DATA");
	}
	const url = new URL((await readFile(config.databaseUrlFile, "utf8")).trim());
	if (["[YOUR-PASSWORD]", "[YOUR_PASSWORD]", "YOUR_PASSWORD"].includes(decodeURIComponent(url.password))) {
		const freshPassword = (await readFile(path.join(path.dirname(configPath), "target-database-password.txt"), "utf8")).trim();
		assert.match(freshPassword, /^[a-f0-9]{64}$/); url.password = freshPassword;
	}
	assert.ok(cloudTargetAllowed(url, config.targetRef), "UNAPPROVED_CLOUD_TARGET");
	const serviceKey = (await readFile(config.serviceKeyFile, "utf8")).trim(); assert.ok(serviceKey.length > 30, "SERVICE_KEY_REQUIRED");
	const publishableKey = (await readFile(config.publishableKeyFile, "utf8")).trim(); assert.ok(publishableKey.length > 20);
	const originalState = JSON.parse(await readFile("tmp/fix-e/8a60a0b7-8450-4e41-8b43-2c58204660a8/state.json", "utf8"));
	const keyFile = path.join(path.dirname(originalState.environment.PM_BACKUP_KEY_FILE), "from-phone.backup-key");
	const key = await backupKey(keyFile);
	const workspace = path.join(path.dirname(configPath), `apply-${randomBytes(8).toString("hex")}`); await privateDirectory(workspace);
	await writeFile("tmp/p3-05/recovery-cloud-apply.pending", JSON.stringify({ targetRef: config.targetRef, sourceSet: scope.sourceSet, startedAt: new Date().toISOString() }), { flag: "wx" });
	const endpoint = `https://${config.targetRef}.supabase.co`;
	const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(60000), ...(init?.signal ? [init.signal] : [])]) }) } };
	const adminApi = createClient(endpoint, serviceKey, options);
	const ca = await readFile(config.caFile, "utf8"); const db = databaseClient(url, ca);
	const cancel = cancelDatabaseOnAbort(db, signal); db.on("error", () => { /* queries reject; never emit credential-bearing client errors */ });
	let connected = false;
	try {
		phase = "authenticate-downloaded-set";
		await authenticatedBackup({ directory: copy.directory, workspace: path.join(workspace, "authenticated"), key, signal }, async ({ manifest, staging }) => {
			assert.equal(manifest.projectRef, scope.sourceRef); assert.equal(Object.keys(manifest.tables).length, scope.scope.businessTables);
			assert.equal(manifest.objects.length, scope.scope.privateReferencedObjects); assert.equal(manifest.migrations.length, scope.scope.migrations);
			phase = "target-empty-preflight"; await db.connect(); connected = true;
			const empty = (await query(db, `select current_user as actor,current_setting('server_version_num')::int as version,
			 (select count(*)::int from pg_namespace where nspname='pm') as business_schemas,
			 (select count(*)::int from pg_roles where rolname in ('partmeasure_runtime','partmeasure_worker')) as custom_roles,
			 (select count(*)::int from auth.users) as users,(select count(*)::int from auth.identities) as identities,
			 (select count(*)::int from auth.sessions) as sessions,(select count(*)::int from storage.objects) as objects,
			 (select count(*)::int from storage.buckets) as buckets,
			 (select count(*)::int from pg_namespace where nspname='supabase_migrations') as history_schema,
			 (select count(*)::int from pg_tables where schemaname='supabase_migrations') as history_tables`)).rows[0];
			assert.equal(empty.actor, "postgres"); assert.ok(empty.version >= 170000 && empty.version < 180000, "TARGET_PG_MAJOR_MISMATCH");
			for (const field of ["business_schemas", "custom_roles", "users", "identities", "sessions", "objects", "buckets", "history_tables"]) assert.equal(empty[field], 0, "TARGET_NOT_EMPTY");
			const columns = (await query(db, "select table_name,column_name from information_schema.columns where table_schema='auth' and table_name in ('users','identities')")).rows;
			for (const table of cloudAuthTables) for (const column of plan.authTables[table].columns) assert.ok(columns.some(c => c.table_name === table && c.column_name === column), "TARGET_AUTH_COLUMN_MISMATCH");
			const bucketCheck = await adminApi.storage.listBuckets(); assert.equal(bucketCheck.error, null, "TARGET_STORAGE_CREDENTIAL_REJECTED"); assert.equal(bucketCheck.data?.length, 0);
			phase = "begin-target-only-restore";
			await query(db, "begin; set local timezone='UTC'; set local statement_timeout='300000'; set local lock_timeout='5000'");
			await query(db, "select pg_advisory_xact_lock(hashtextextended('partmeasure:new-cloud-restore:v1',0))");
			// Repeat freshness inside the write transaction; no clean/drop/overwrite path exists.
			const guard = (await query(db, "select (select count(*)::int from auth.users) as users,(select count(*)::int from storage.objects) as objects,(select count(*)::int from pg_namespace where nspname='pm') as schemas")).rows[0];
			assert.deepEqual(guard, { users: 0, objects: 0, schemas: 0 }, "TARGET_CHANGED_AFTER_PREFLIGHT");
			for (const migration of manifest.migrations) await query(db, await readFile(path.join(staging, migration.file), "utf8"));
			await query(db, "set local session_replication_role=replica");
			const dump = path.join(staging, manifest.database.file);
			phase = "import-auth-users-and-identities";
			const authRows = await importData(db, config.postgresBin, dump, "auth", new Set(cloudAuthTables));
			assert.equal(authRows.users, scope.scope.authUsers); assert.equal(authRows.identities, scope.scope.identities);
			phase = "import-business-and-history";
			await importData(db, config.postgresBin, dump, "pm", new Set(Object.keys(manifest.tables)));
			phase = "import-application-migration-history";
			let historySchema = await dumpText(config.postgresBin, dump, ["--schema-only", "--schema=supabase_migrations"]);
			// pg_restore --schema filters objects by namespace and may omit the
			// namespace entry itself. Create this application history schema explicitly.
			if (empty.history_schema === 0) await query(db, "create schema supabase_migrations");
			historySchema = historySchema.replace(/^CREATE SCHEMA "?supabase_migrations"?;\r?\n/m, "");
			await query(db, historySchema);
			await importData(db, config.postgresBin, dump, "supabase_migrations", new Set(["schema_migrations"]));
			phase = "verify-all-table-fingerprints";
			const actual = await databaseFingerprints(db, signal); assert.deepEqual(actual, manifest.tables, "RESTORED_DATABASE_MISMATCH");
			phase = "invalidate-old-capabilities";
			await query(db, "update pm.share_links set revoked_at=coalesce(revoked_at,now()); update pm.guest_sessions set expires_at=least(expires_at,now())");
			await query(db, "update pm.upload_reservations set state='rejected',error_code='RESTORE_REQUIRES_NEW_UPLOAD',processing_token=null,processing_until=null,cleanup_after=greatest(cleanup_after,now()+interval '27 hours') where state in ('reserved','queued','processing')");
			// Preserve idempotency rows while preventing replay of source upload grants/results.
			await query(db, "update pm.idempotency_keys set result='{\"error\":\"RESTORE_REQUIRES_NEW_REQUEST\"}'::jsonb,request_hash=encode(sha256(convert_to(key::text||':restore:'||$1,'UTF8')),'hex')", [config.targetRef]);
			await query(db, `update auth.users set ${userTokenColumns.map(c => `${recoveryIdentifier(c)}=''`).join(",")}`);
			const runtimePassword = randomBytes(32).toString("hex");
			await query(db, `alter role partmeasure_runtime password '${runtimePassword}'; alter role partmeasure_worker nologin`);
			const runtimeUrl = new URL(url); runtimeUrl.username = url.hostname.includes("pooler") ? `partmeasure_runtime.${config.targetRef}` : "partmeasure_runtime"; runtimeUrl.password = runtimePassword;
			await writeFile(path.join(workspace, "runtime-database-url.txt"), runtimeUrl.href, { flag: "wx", mode: 0o600 });
			await query(db, "set local session_replication_role=origin; commit");
			phase = "restore-private-object-bytes";
			for (const object of manifest.objects) {
				const bytes = await readFile(path.join(staging, object.file)); assert.equal(bytes.length, object.bytes);
				const upload = await adminApi.storage.from(object.bucket).upload(object.key, bytes, { contentType: object.mime, upsert: false });
				assert.equal(upload.error, null, "PRIVATE_OBJECT_UPLOAD_FAILED"); counts.objectsUploaded++;
				const download = await adminApi.storage.from(object.bucket).download(object.key); assert.equal(download.error, null, "PRIVATE_OBJECT_READBACK_FAILED"); assert.ok(download.data);
				const returned = Buffer.from(await download.data.arrayBuffer()); assert.equal(returned.length, object.bytes); assert.equal(createHash("sha256").update(returned).digest("hex"), object.sha256, "PRIVATE_OBJECT_HASH_MISMATCH"); counts.objectsVerified++;
				if (counts.objectsVerified % 10 === 0 || counts.objectsVerified === manifest.objects.length) console.log(JSON.stringify({ phase, ...counts }));
			}
			phase = "new-normal-auth-login";
			const accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8")); counts.loginAttempts++;
			const auth = createClient(endpoint, publishableKey, options); const login = await auth.auth.signInWithPassword(accounts.A);
			assert.equal(login.error, null, "RESTORED_PASSWORD_LOGIN_FAILED"); assert.ok(login.data.user && login.data.session);
			const confirmed = await auth.auth.getUser(); assert.equal(confirmed.error, null); assert.equal(confirmed.data.user?.id, login.data.user.id);
			phase = "runtime-owner-and-denial";
			const runtime = databaseClient(runtimeUrl, ca); runtime.on("error", () => {}); const stopRuntime = cancelDatabaseOnAbort(runtime, signal);
			try {
				await runtime.connect(); await query(runtime, "begin read only"); await query(runtime, "select set_config('pm.owner_id',$1,true)", [login.data.user.id]);
				const expectedProjects = (await query(db, "select id from pm.projects where owner_id=$1 order by id", [login.data.user.id])).rows;
				assert.ok(expectedProjects.length > 0, "RESTORED_LOGIN_HAS_NO_PROJECT");
				const visible = (await query(runtime, "select id from pm.projects order by id")).rows; assert.deepEqual(visible, expectedProjects);
				const other = (await query(db, "select id from auth.users where id<>$1 order by id limit 1", [login.data.user.id])).rows[0]; assert.ok(other);
				await query(runtime, "select set_config('pm.owner_id',$1,true)", [other.id]); assert.equal((await query(runtime, "select id from pm.projects where id=$1", [expectedProjects[0]?.id])).rowCount, 0);
				await query(runtime, "select set_config('pm.owner_id','',true)"); assert.equal((await query(runtime, "select id from pm.projects")).rowCount, 0); await query(runtime, "rollback");
			} finally { stopRuntime(); await runtime.end().catch(() => {}); }
			const closure = (await query(db, `select (select count(*)::int from storage.objects where bucket_id='partmeasure-private') as objects,
			 (select count(*)::int from storage.buckets where public) as public_buckets,
			 (select count(*)::int from pm.share_links where revoked_at is null and expires_at>now()) as active_shares,
			 (select count(*)::int from pm.guest_sessions where expires_at>now()) as active_guests,
			 (select count(*)::int from supabase_migrations.schema_migrations) as migrations`)).rows[0];
			assert.equal(closure.objects, manifest.objects.length); assert.equal(closure.public_buckets, 0); assert.equal(closure.active_shares, 0); assert.equal(closure.active_guests, 0); assert.equal(closure.migrations, manifest.migrations.length);
			const result = { checkedAt: new Date().toISOString(), status: "TARGET_RESTORE_PASS_SOURCE_RESUME_STILL_REQUIRED", targetRef: config.targetRef, sourceSet: scope.sourceSet,
				tables: Object.keys(actual).length, tableFingerprintsBeforeInvalidationMatch: true, objects: manifest.objects.length, allObjectReadbackHashesMatch: true, authRows,
				oldAuthSessionsAndClaimsImported: false, oldAuthTokensCleared: true, oldIdempotencyReplayInvalidated: true, normalAuthLoginVerified: true, ownerRuntimeAndCrossOwnerDenialVerified: true,
				closure, ...counts, sourceResumed: false, productionReleased: false };
			await writeFile("docs/evidence/p3-05/recovery-cloud-target.json", `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" }); console.log(JSON.stringify(result));
		});
	} finally { key.fill(0); cancel(); if (connected) await db.query("rollback").catch(() => {}); await db.end().catch(() => {}); }
}
(process.argv.length === 3 && process.argv[2] === "--prepare" ? prepareOnly() : main()).finally(() => clearInterval(progress)).catch(async error => {
	const e = error as { name?: string; code?: string; cause?: { code?: string }; message?: string; schema?: string; position?: string };
	const firstLine = e.message?.split(/\r?\n/, 1)[0] ?? "";
	const missingSchema = e.message?.match(/^schema "([a-z_][a-z0-9_]*)" does not exist$/)?.[1];
	const failure = { checkedAt: new Date().toISOString(), status: "FAIL_SOURCE_RESUME_REQUIRED_IF_PAUSED", phase, ...counts, name: e.name, code: e.code, causeCode: e.cause?.code, missingSchema, position: /^\d+$/.test(e.position ?? "") ? e.position : undefined, reason: /^[A-Z][A-Z0-9_]+$/.test(firstLine) ? firstLine : "REDACTED_TECHNICAL_ERROR" };
	console.error(JSON.stringify(failure)); await writeFile(`docs/evidence/p3-05/${phase === "offline-import-parser" ? "recovery-import-preflight-failure" : "recovery-cloud-failure"}.json`, `${JSON.stringify(failure, null, 2)}\n`); process.exitCode = 1;
});
