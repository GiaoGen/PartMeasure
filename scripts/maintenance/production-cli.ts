// Local operator entrypoint; production credentials never pass through argv or stdout.
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { productionProjectRef, maintenanceProject } from "./project-target";

async function main() {
	const args = process.argv.slice(2); assert.equal(args.length, 1);
	const action = args[0]; assert.ok(["status", "backup", "cleanup-dry-run"].includes(action ?? ""));
	assert.ok(!process.env.VERCEL, "LOCAL_OPERATOR_ONLY");
	const root = path.resolve("tmp/p3-05/production");
	const state = JSON.parse(await readFile(path.join(root, "controller.json"), "utf8"));
	assert.equal(state.verified, true); assert.equal(state.targetRef, productionProjectRef);
	const config: Record<string, string> = JSON.parse(await readFile(path.join(root, "maintenance-environment.json"), "utf8"));
	assert.equal(maintenanceProject(config), productionProjectRef);
	assert.equal(config.NEXT_PUBLIC_SUPABASE_URL, `https://${productionProjectRef}.supabase.co`);
	const env: NodeJS.ProcessEnv = { ...process.env, ...config, NODE_ENV: "production" }; delete env.VERCEL; delete env.VERCEL_ENV; delete env.PM_EVENTS_LOCAL;
	async function run(file: string, command: string[], extra: Record<string, string> = {}) {
		const records: Record<string, unknown>[] = []; let buffered = "", errors = "";
		const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", file, ...command], { cwd: process.cwd(), env: { ...env, ...extra }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], signal: AbortSignal.timeout(25 * 60 * 1000) });
		child.stdout.on("data", chunk => { buffered += String(chunk); for (;;) { const end = buffered.indexOf("\n"); if (end < 0) break; const line = buffered.slice(0, end); buffered = buffered.slice(end + 1); try { const value = JSON.parse(line); if (typeof value?.event === "string") { records.push(value); console.log(JSON.stringify(value)); } } catch { /* No raw tool output. */ } } });
		child.stderr.on("data", chunk => { if (errors.length < 8192) errors += String(chunk).slice(0, 8192 - errors.length); });
		const code = await new Promise<number | null>((resolve, reject) => { child.once("error", () => reject(Error("MAINTENANCE_PROCESS_FAILED"))); child.once("close", resolve); });
		for (const line of errors.split(/\r?\n/)) { try { const value = JSON.parse(line); if (["backup_maintenance_failed", "maintenance_status_failed", "upload_cleanup_failed"].includes(value?.event)) console.error(JSON.stringify(value)); } catch { /* Never print raw exceptions or URLs. */ } }
		return { code, records };
	}
	if (action === "status") { const result = await run("scripts/maintenance/status-cli.ts", ["--database", "--record"]); process.exitCode = result.code ?? 1; return; }
	if (action === "cleanup-dry-run") { const result = await run("scripts/p3-03/cleanup-uploads.ts", ["--dry-run"]); process.exitCode = result.code ?? 1; return; }
	const created = await run("scripts/maintenance/backup-cli.ts", ["create"]); assert.equal(created.code, 0, "BACKUP_CREATE_FAILED");
	const complete = created.records.find(r => r.event === "backup_complete"); assert.ok(complete); assert.match(String(complete.setId), /^[a-f0-9-]{36}$/);
	const directory = path.resolve("tmp/backups", String(complete.setId));
	const inspected = await run("scripts/maintenance/backup-cli.ts", ["inspect"], { PM_BACKUP_SET: directory }); assert.equal(inspected.code, 0, "BACKUP_AUTHENTICATION_FAILED");
	const authenticated = inspected.records.find(r => r.event === "backup_authenticated"); assert.ok(authenticated);
	for (const key of ["objects", "bytes", "tables", "createdAt"]) assert.equal(complete[key], authenticated[key]);
	const receipt = { version: 1, projectRef: productionProjectRef, setId: complete.setId, snapshotAt: complete.createdAt, authenticatedAt: new Date().toISOString(), objects: complete.objects, bytes: complete.bytes, tables: complete.tables, authenticated: true, offDeviceCopyVerified: false };
	const temporary = path.join(root, `${randomUUID()}.json`); await writeFile(temporary, JSON.stringify(receipt), { flag: "wx", mode: 0o600 }); await rename(temporary, path.join(root, "last-backup.json"));
	console.log(JSON.stringify({ event: "production_backup_authenticated", ...receipt, copyStillRequired: true }));
}
main().catch(() => { console.error(JSON.stringify({ event: "production_maintenance_stopped", code: "CHECK_PRIVATE_CONFIGURATION_OR_LAST_STRUCTURED_STAGE", retryAutomatically: false })); process.exitCode = 1; });
