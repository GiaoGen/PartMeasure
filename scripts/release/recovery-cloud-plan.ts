// Inspect only the already authenticated source dump for managed-cloud compatibility.
// Does not connect to a database, provision resources or execute restore SQL.
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile, realpath, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { backupKey, decryptFile } from "../maintenance/encrypted-file";
import { manifestSchema, backupLimits } from "../maintenance/backup-model";
import { privateDirectory } from "../maintenance/private-directory";
import { postgresTool } from "../maintenance/postgres-tools";

let phase = "load-private-state";
async function main() {
	const mode = process.argv[2] ?? "initial";
	assert.ok(["initial", "--diagnose-failure", "--stdout-fixed"].includes(mode), "INVALID_INSPECTION_ARGS");
	assert.ok(process.argv.length === (mode === "initial" ? 2 : 3), "INVALID_INSPECTION_ARGS");
	const archive = JSON.parse(await readFile("tmp/p3-05/recovery-archive.json", "utf8"));
	const state = JSON.parse(await readFile(`tmp/fix-e/${archive.run}/state.json`, "utf8"));
	assert.equal(state.backupAttempt, "complete");
	const source = await realpath(state.environment.PM_BACKUP_SET);
	assert.equal(source, await realpath(`tmp/backups/${archive.sourceSet}`));
	const workspace = path.resolve(`tmp/p3-05/recovery-cloud-plan-${randomUUID()}`);
	phase = "private-workspace"; await privateDirectory(workspace);
	await writeFile(`tmp/p3-05/recovery-cloud-plan-${mode.replace(/^--/, "")}.pending`, JSON.stringify({ sourceSet: archive.sourceSet, workspace }), { flag: "wx" });
	const key = await backupKey(state.environment.PM_BACKUP_KEY_FILE);
	const signal = AbortSignal.timeout(2 * 60 * 1000);
	try {
		phase = "decrypt-manifest"; const manifestFile = path.join(workspace, "manifest.json");
		await decryptFile(path.join(source, "manifest.pmb"), manifestFile, "manifest", key, null, backupLimits.manifestBytes, signal);
		const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestFile, "utf8")));
		phase = "decrypt-database"; const dump = path.join(workspace, "database.dump");
		await decryptFile(path.join(source, manifest.database.file), dump, manifest.database.name, key, manifest.database, manifest.database.bytes, signal);
		const tool = (args: string[]) => postgresTool(state.environment.PM_POSTGRES_BIN, "pg_restore", [...args, dump], process.env, signal);
		phase = "dump-index"; const index = tool(["--list"]); let toc = "";
		try { for await (const chunk of index.output) { toc += String(chunk); assert.ok(Buffer.byteLength(toc) < 2 * 1024 ** 2); } await index.done; }
		catch (error) { index.stop(); throw error; }
		phase = "index-classification"; const authData = [...toc.matchAll(/^\d+;\s+\d+\s+\d+\s+TABLE DATA\s+auth\s+([a-z_]+)\s+/gm)].map(v => v[1]).sort();
		const business = [...toc.matchAll(/^\d+;\s+\d+\s+\d+\s+TABLE DATA\s+pm\s+([a-z_]+)\s+/gm)].map(v => v[1]).sort();
		assert.deepEqual(business, Object.keys(manifest.tables).sort());
		const transient = ["sessions", "refresh_tokens", "one_time_tokens", "flow_state", "mfa_challenges", "saml_relay_states"];
		assert.ok(transient.every(t => !authData.includes(t)));
		phase = "auth-data-inventory"; const data = tool(["--data-only", "--schema=auth", "--no-owner", "--no-acl", "--file=-"]);
		const authTables: Record<string, { columns: string[]; rows: number }> = {};
		let current: string | null = null, bytes = 0;
		try {
			for await (const line of createInterface({ input: data.output, crlfDelay: Infinity })) {
				bytes += Buffer.byteLength(line) + 1; assert.ok(bytes < 32 * 1024 ** 2, "AUTH_INSPECTION_LIMIT");
				if (current) { if (line === "\\.") current = null; else { const table = authTables[current]; assert.ok(table); table.rows++; } continue; }
				const copy = line.match(/^COPY auth\.([a-z_]+) \(([^)]+)\) FROM stdin;$/);
				if (copy) {
					const name = copy[1], columns = copy[2]; assert.ok(name && columns && !authTables[name]);
					authTables[name] = { columns: columns.split(",").map(v => v.trim().replace(/^"|"$/g, "")), rows: 0 }; current = name;
				}
			}
			await data.done; assert.equal(current, null); assert.deepEqual(Object.keys(authTables).sort(), authData);
		} catch (error) { data.stop(); throw error; }
		for (const table of ["users", "identities"]) assert.ok(authTables[table]);
		const nonemptyOtherAuth = Object.entries(authTables).filter(([name, value]) => value.rows > 0 && !["users", "identities", "schema_migrations", "audit_log_entries"].includes(name)).map(([name, value]) => ({ name, rows: value.rows }));
		phase = "write-inventory"; const result = { checkedAt: new Date().toISOString(), status: "OFFLINE_PLAN_COMPLETE_NOT_CLOUD_PASS", sourceSet: archive.sourceSet,
			businessTables: business, referencedObjects: manifest.objects.length, migrationFiles: manifest.migrations.length,
			authTables, nonemptyOtherAuth, activeCapabilityDataExcluded: true, targetRef: null,
			managedSchemas: { authDdl: "KEEP_TARGET_MANAGED", authSchemaMigrations: "KEEP_TARGET_MANAGED", storageMetadata: "CREATE_PRIVATE_BUCKETS_AND_UPLOAD_VIA_STORAGE_API", businessMigrations: "REPLAY_AUTHENTICATED_FORMAL_FILES_ON_FRESH_TARGET" },
			roles: { custom: ["partmeasure_runtime", "partmeasure_worker"], passwords: "FRESH_TARGET_ONLY_PRIVATE_FILES_NOT_BACKUP_OR_CHAT", privileges: "NOSUPERUSER_NOCREATEROLE_NOBYPASSRLS" },
			restoreOrder: ["Validate explicitly approved fresh ref/org/region plus zero business/auth users/object counts", "Check managed auth columns against this exact dump inventory", "Create only approved application roles/schema from authenticated migrations", "Import users/identities preserving IDs/password hashes, exclude provider migrations/audit and all active capability data", "Load exact pm data with controlled trigger suppression inside fresh-target transaction; verify every table fingerprint before capability invalidation", "Revoke restored shares/Guest and pending upload capabilities", "Upload each referenced object through private target Storage; verify downloaded size/hash/reference closure", "Verify fresh normal Auth login, historical reads and runtime/RLS permissions, old capabilities denied", "Pause recovery target and resume source, verify original environment availability"],
			unresolved: ["Operator downloaded-copy and phone-key verification", "Explicit source downtime and full private lab restore-data scope", "Actual fresh target version/credentials and managed Auth column compatibility", ...(nonemptyOtherAuth.length ? ["Nonempty persistent Auth tables outside users/identities require explicit handling"] : [])],
			cloudConnectionAttempted: false, resourcesCreated: false, sourcePaused: false, applyImplemented: false };
		await writeFile("docs/evidence/p3-05/recovery-cloud-plan.json", `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
		console.log(JSON.stringify({ status: result.status, businessTables: business.length, authRows: Object.fromEntries(Object.entries(authTables).map(([name, value]) => [name, value.rows])), nonemptyOtherAuth, cloudConnectionAttempted: false }));
	} finally {
		key.fill(0);
		const resolved = await realpath(workspace);
		assert.equal(path.dirname(resolved), path.resolve("tmp/p3-05"));
		assert.ok(path.basename(resolved).startsWith("recovery-cloud-plan-"));
		await rm(resolved, { recursive: true, force: true });
	}
}
main().catch(error => { const e = error as { name?: string; code?: string; message?: string }; console.error(JSON.stringify({ status: "FAIL", phase, name: e.name, code: e.code, reason: /^[A-Z][A-Z0-9_]+$/.test(e.message ?? "") ? e.message : "UNCLASSIFIED_INSPECTION_FAILURE" })); process.exitCode = 1; });
