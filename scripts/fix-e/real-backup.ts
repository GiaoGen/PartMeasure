// No-argument preparation is local only; cloud operations here are READ-ONLY backup/probes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import nextEnv from "@next/env";
import { sourceAllowed } from "../maintenance/backup-model";
import { databaseClient } from "../maintenance/backup";
import { privateDirectory } from "../maintenance/private-directory";
import { connectionFailure } from "../maintenance/connection-model";

type State = { run: string; environment: Record<string, string>; backupAttempt?: "pending" | "complete" | "failed"; setId?: string; copyAttempt?: "pending" | "complete" | "failed" };
let state: State | undefined, directory: string | undefined;
async function save() {
	assert.ok(state && directory); const staging = `${directory}/${randomUUID()}.json`;
	await writeFile(staging, JSON.stringify(state), { flag: "wx", mode: 0o600 }); await rename(staging, `${directory}/state.json`);
}
async function command(action: "keygen" | "create" | "inspect" | "copy", extra: Record<string, string> = {}) {
	assert.ok(state);
	const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/maintenance/backup-cli.ts", action],
		{ cwd: process.cwd(), env: { ...process.env, ...state.environment, ...extra }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
	const records: Record<string, unknown>[] = [];
	let buffered = "";
	child.stdout.on("data", chunk => {
		buffered += String(chunk);
		for (;;) {
			const end = buffered.indexOf("\n"); if (end < 0) break;
			const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
			try { const value = JSON.parse(line); if (value && typeof value.event === "string") { records.push(value); console.log(JSON.stringify(value)); } } catch { /* Never forward raw tool output. */ }
		}
	});
	let errors = "";
	child.stderr.on("data", chunk => { if (errors.length < 8192) errors += String(chunk).slice(0, 8192-errors.length); });
	const code = await new Promise<number | null>((resolve, reject) => { child.once("error", () => reject(Error("BACKUP_PROCESS_FAILED"))); child.once("close", resolve); });
	for (const line of errors.split(/\r?\n/)) {
		try { const value = JSON.parse(line); if (value?.event === "backup_maintenance_failed") records.push(value); } catch { /* Raw errors may contain private values. */ }
	}
	return { code, records, diagnostic: { unhandledClientError: /Unhandled 'error' event|Emitted 'error' event on Client/.test(errors),
		unhandledAbort: /AbortError/.test(errors), stderrPresent: Boolean(errors) } };
}
async function main() {
	nextEnv.loadEnvConfig(process.cwd(), true);
	const args = process.argv.slice(2);
	await mkdir("tmp/fix-e", { recursive: true }); await mkdir("docs/evidence/fix-e", { recursive: true });
	if (!args.length) {
		const source = new URL((await readFile("tmp/p0-1/admin-database-url.txt", "utf8")).trim());
		assert.equal(decodeURIComponent(source.username), "postgres.rvysclscetfqicpnzlra");
		assert.match(source.hostname, /^aws-[a-z0-9-]+\.pooler\.supabase\.com$/); assert.ok(["5432", "6543"].includes(source.port));
		source.port = "5432";
		const password = decodeURIComponent(source.password);
		if (password.startsWith("[") && password.endsWith("]")) source.password = encodeURIComponent(password.slice(1,-1));
		assert.ok(sourceAllowed(source, false));
		const run = randomUUID(); directory = `tmp/fix-e/${run}`; await privateDirectory(directory);
		const sourceFile = path.resolve(directory, "source-session-url.txt");
		await writeFile(sourceFile, source.href, { flag: "wx", mode: 0o600 });
		const keyRoot = path.resolve("tmp/maintenance-keys", `fix-e-${run}`);
		state = { run, environment: { PM_POSTGRES_BIN: "C:/Program Files/PostgreSQL/18/bin", PM_BACKUP_DATABASE_URL_FILE: sourceFile,
			PM_BACKUP_KEY_FILE: path.join(keyRoot, "backup.backup-key"), DATABASE_CA_FILE: process.env.DATABASE_CA_FILE ?? "" } };
		assert.ok(state.environment.DATABASE_CA_FILE); await save();
		assert.equal((await command("keygen")).code, 0);
		await writeFile(`docs/evidence/fix-e/${run}-preparation.json`, `${JSON.stringify({ run, preparedAt: new Date().toISOString(), cloudContacted: false,
			originalSourceUnchanged: true, sameLabSessionPortPrepared: true, newKeyCreatedAndNotPrinted: true,
			keyStoredSeparatelyFromBackupSet: true, independentDeviceCopy: false, postgresMajor: 18 }, null, 2)}\n`);
		console.log(JSON.stringify({ run, preparedOnly: true })); return;
	}
	assert.equal(args.length, 2); assert.ok(["--probe", "--create", "--inspect", "--copy"].includes(args[0] as string));
	assert.match(args[1] as string, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
	directory = `tmp/fix-e/${args[1]}`; state = JSON.parse(await readFile(`${directory}/state.json`, "utf8")) as State;
	assert.equal(state.run, args[1]);
	const url = new URL((await readFile(state.environment.PM_BACKUP_DATABASE_URL_FILE as string, "utf8")).trim()); assert.ok(sourceAllowed(url, false));
	if (args[0] === "--probe") {
		const db = databaseClient(url, await readFile(state.environment.DATABASE_CA_FILE as string, "utf8"));
		const started = Date.now();
		try {
			await db.connect(); await db.query("begin read only; set local statement_timeout='10000'");
			const result = (await db.query("select current_user as role,current_setting('server_version') as version,pg_export_snapshot() is not null as snapshot,(select count(*)::int from pg_tables where schemaname='pm') as business_tables")).rows[0];
			assert.equal(result.role, "postgres"); assert.ok(result.snapshot && result.business_tables > 0);
			await writeFile(`docs/evidence/fix-e/${state.run}-probe.json`, `${JSON.stringify({ checkedAt: new Date().toISOString(), scope: "Real isolated session connection, verified TLS, read-only export snapshot. Not application permission or restore acceptance.", status: "PASS", serverVersion: result.version, businessTables: result.business_tables, milliseconds: Date.now()-started }, null, 2)}\n`);
			console.log(JSON.stringify({ event: "backup_source_probe", status: "PASS", businessTables: result.business_tables }));
		} catch (error) {
			await writeFile(`docs/evidence/fix-e/${state.run}-probe.json`, `${JSON.stringify({ checkedAt: new Date().toISOString(), status: "NOT_PASSED", ...connectionFailure(error) }, null, 2)}\n`); throw error;
		} finally { await db.query("rollback").catch(() => {}); await db.end().catch(() => {}); }
		return;
	}
	if (args[0] === "--create") {
		assert.equal(state.backupAttempt, undefined, "BACKUP_ATTEMPT_REQUIRES_REVIEW"); state.backupAttempt = "pending"; await save();
		const started = Date.now(), result = await command("create");
		const complete = result.records.find(item => item.event === "backup_complete");
		state.backupAttempt = complete && result.code === 0 ? "complete" : "failed";
		if (state.backupAttempt === "complete") { state.setId = String(complete?.setId); state.environment.PM_BACKUP_SET = path.resolve("tmp/backups", state.setId); }
		await save();
		await writeFile(`docs/evidence/fix-e/${state.run}-create.json`, `${JSON.stringify({ run: state.run, checkedAt: new Date().toISOString(), milliseconds: Date.now()-started, exitCode: result.code, records: result.records, diagnostic: result.diagnostic,
			scope: "Actual isolated cloud database snapshot and referenced private bytes encrypted locally; no cloud data writes, restore, session invalidation or object deletion; not off-device backup or hosted restore acceptance." }, null, 2)}\n`);
		assert.equal(result.code, 0); return;
	}
	assert.ok(state.setId && state.environment.PM_BACKUP_SET);
	if (args[0] === "--copy") {
		assert.equal(state.copyAttempt, undefined, "BACKUP_COPY_ATTEMPT_REQUIRES_REVIEW");
		state.copyAttempt = "pending"; await save(); await mkdir("tmp/backup-copies", { recursive: true });
		const result = await command("copy", { PM_BACKUP_COPY_DIRECTORY: path.resolve("tmp/backup-copies", state.run) });
		state.copyAttempt = result.code === 0 ? "complete" : "failed"; await save();
		await writeFile(`docs/evidence/fix-e/${state.run}-copy.json`, `${JSON.stringify({ run: state.run, checkedAt: new Date().toISOString(), exitCode: result.code, records: result.records,
			scope: "New same-workspace ciphertext copy and independent full authentication; key not copied. Same machine/volume, not an off-device backup or independent key custody." }, null, 2)}\n`);
		assert.equal(result.code, 0); return;
	}
	const result = await command("inspect", { DATABASE_CA_FILE: "", PM_POSTGRES_BIN: "", PM_RESTORE_DATABASE_URL_FILE: "" });
	await writeFile(`docs/evidence/fix-e/${state.run}-inspect.json`, `${JSON.stringify({ run: state.run, checkedAt: new Date().toISOString(), exitCode: result.code, records: result.records,
		scope: "Offline GCM and plaintext size/hash authentication of every backup artifact; no DB/CA/PostgreSQL binary configuration required; no cloud or restore target used." }, null, 2)}\n`);
	assert.equal(result.code, 0);
}
main().catch(error => { console.error(JSON.stringify({ event: "fix_e_backup_check_failed", ...connectionFailure(error) })); process.exitCode = 1; });
