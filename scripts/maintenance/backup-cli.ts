import nextEnv from "@next/env";
import path from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { backupKey } from "./encrypted-file";
import { createBackup } from "./backup";
import { restoreBackup, recoveryCounts } from "./restore";
import { backupLimits } from "./backup-model";
import { storage, privateBucket } from "../../src/lib/server/storage";
import { restrictDirectory } from "./private-directory";

// Deliberately no database/password/key command-line arguments.
async function main() {
	nextEnv.loadEnvConfig(process.cwd());
	const args = process.argv.slice(2), action = args[0];
	if (!action || !["create", "inspect", "restore", "keygen"].includes(action) || args.length !== (action === "restore" ? 2 : 1) || action === "restore" && args[1] !== "--apply") throw Error("INVALID_MAINTENANCE_ACTION");
	const root = path.resolve("tmp/backups"); await mkdir(root, { recursive: true, mode: 0o700 });
	const keyFile = process.env.PM_BACKUP_KEY_FILE;
	if (!keyFile) throw Error("BACKUP_KEY_FILE_REQUIRED");
	if (action === "keygen") {
		// The operator selects a separate private key location. Never overwrite it or print it.
		const keyRoot = path.resolve("tmp/maintenance-keys");
		if (!path.resolve(keyFile).startsWith(`${keyRoot}${path.sep}`)) throw Error("PRIVATE_KEY_LOCATION_REQUIRED");
		await mkdir(path.dirname(path.resolve(keyFile)), { recursive: true, mode: 0o700 });
		await restrictDirectory(path.dirname(path.resolve(keyFile)));
		await writeFile(keyFile, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
		console.log(JSON.stringify({ event: "backup_key_created", printed: false })); return;
	}
	const key = await backupKey(keyFile), caFile = process.env.DATABASE_CA_FILE, bin = process.env.PM_POSTGRES_BIN;
	if (!caFile || !bin) throw Error("MAINTENANCE_CONFIGURATION_REQUIRED");
	const signal = AbortSignal.timeout(backupLimits.durationMs);
	if (action === "create") {
		const sourceFile = process.env.PM_BACKUP_DATABASE_URL_FILE;
		if (!sourceFile || new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid").hostname !== "rvysclscetfqicpnzlra.supabase.co") throw Error("ISOLATED_BACKUP_ONLY");
		const sourceUrl = new URL((await readFile(sourceFile, "utf8")).trim());
		const password = decodeURIComponent(sourceUrl.password);
		if (password.startsWith("[") && password.endsWith("]")) sourceUrl.password = encodeURIComponent(password.slice(1, -1));
		const setId = randomUUID();
		const manifest = await createBackup({ sourceUrl, caFile, postgresBin: bin, directory: path.join(root, setId), key, native: false, signal,
			readObject: async (name, deadline) => {
				const { data, error } = await storage(deadline).from(privateBucket).createSignedUrl(name, 60);
				if (error || !data) throw Error("BACKUP_STORAGE_UNAVAILABLE");
				const response = await fetch(data.signedUrl, { cache: "no-store", signal: AbortSignal.any([deadline, AbortSignal.timeout(60000)]) });
				if (response.status !== 200 || !response.body) { void response.body?.cancel().catch(() => {}); throw Error("BACKUP_OBJECT_UNAVAILABLE"); }
				return Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
			} });
		console.log(JSON.stringify({ event: "backup_complete", setId, ...recoveryCounts(manifest) })); return;
	}
	const directory = process.env.PM_BACKUP_SET, target = process.env.PM_RESTORE_DATABASE_URL_FILE;
	if (!directory || !target) throw Error("RESTORE_CONFIGURATION_REQUIRED");
	const targetUrl = new URL((await readFile(target, "utf8")).trim());
	const recoveryId = `restore-${randomUUID()}`;
	const result = await restoreBackup({ directory, workspace: path.join(root, recoveryId), targetUrl, caFile, postgresBin: bin, key, apply: action === "restore", signal });
	console.log(JSON.stringify({ event: action === "restore" ? "restore_complete" : "backup_authenticated", recoveryId, applied: result.applied, objects: result.objects, tables: result.tables }));
}
main().catch(() => { console.error("BACKUP_MAINTENANCE_FAILED (details redacted)"); process.exitCode = 1; });
