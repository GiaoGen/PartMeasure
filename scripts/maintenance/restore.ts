import { mkdir, mkdtemp, readFile, realpath, rename, rm, lstat } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { manifestSchema, backupLimits, restoreAllowed, type BackupManifest } from "./backup-model";
import { decryptFile } from "./encrypted-file";
import { databaseClient } from "./backup";
import { databaseFingerprints, pgEnvironment, postgresTool, cancelDatabaseOnAbort } from "./postgres-tools";
import { privateDirectory } from "./private-directory";
import { AppError } from "../../src/lib/policy";

export type RestoreOptions = { directory: string; workspace: string; targetUrl: URL; caFile: string; postgresBin: string; key: Buffer; apply: boolean; signal: AbortSignal };
export type InspectOptions = Pick<RestoreOptions, "directory" | "workspace" | "key" | "signal">;
async function regularFile(root: string, name: string) {
	const file = path.join(root, name), info = await lstat(file);
	if (!info.isFile() || info.isSymbolicLink() || path.dirname(await realpath(file)) !== root) throw Error("UNSAFE_BACKUP_PATH");
	return file;
}
/** Authenticate without requiring database credentials, a CA or PostgreSQL binaries. */
export async function authenticatedBackup<T>(options: InspectOptions, work: (value: { manifest: BackupManifest; staging: string; workspace: string }) => Promise<T>) {
	options.signal.throwIfAborted();
	const directory = await realpath(options.directory);
	await privateDirectory(options.workspace);
	const workspace = await realpath(options.workspace);
	if (workspace === directory || directory.startsWith(`${workspace}${path.sep}`) || workspace.startsWith(`${directory}${path.sep}`)) throw Error("RESTORE_PATH_OVERLAP");
	const staging = await mkdtemp(path.join(workspace, "staging-"));
	try {
		const manifestPath = path.join(staging, "manifest.json");
		const encryptedManifest = await regularFile(directory, "manifest.pmb").catch(error => {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AppError("BACKUP_INCOMPLETE", 422);
			throw error;
		});
		await decryptFile(encryptedManifest, manifestPath, "manifest", options.key, null, backupLimits.manifestBytes, options.signal);
		const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
		// Authenticate EVERY file first. No restore or private-object publication precedes this.
		for (const entry of [manifest.database, ...manifest.objects, ...manifest.migrations]) {
			options.signal.throwIfAborted();
			await decryptFile(await regularFile(directory, entry.file), path.join(staging, entry.file), entry.name, options.key, entry, entry.bytes, options.signal);
		}
		return await work({ manifest, staging, workspace });
	} finally {
		const resolved = await realpath(staging).catch(() => "");
		if (resolved && path.dirname(resolved) === workspace && path.basename(resolved).startsWith("staging-")) await rm(resolved, { recursive: true, force: true });
	}
}
export async function inspectBackup(options: InspectOptions) {
	return authenticatedBackup(options, async ({ manifest }) => ({ applied: false as const, ...recoveryCounts(manifest) }));
}
/** Only a new local marked database is writable. Cloud/in-place restore is intentionally not implemented. */
export async function restoreBackup(options: RestoreOptions) {
	if (!restoreAllowed(options.targetUrl)) throw Error("UNAPPROVED_RESTORE_TARGET");
	if (!options.apply) return inspectBackup(options);
	return authenticatedBackup(options, async ({ manifest, staging, workspace }) => {
	const db = databaseClient(options.targetUrl, await readFile(options.caFile, "utf8"));
	const stopCancellation = cancelDatabaseOnAbort(db, options.signal);
	let connected = false;
	try {
		await db.connect();
		connected = true;
		const guard = (await db.query<{ marker: string; tables: number; name: string }>(`select current_database() as name,
		 shobj_description(oid,'pg_database') as marker,(select count(*)::int from pg_tables where schemaname not in ('pg_catalog','information_schema')) as tables
		 from pg_database where datname=current_database()`)).rows[0];
		if (guard?.marker !== "partmeasure:disposable-restore:v1" || guard.tables !== 0) throw Error("RESTORE_REQUIRES_EMPTY_MARKED_DATABASE");
		const tool = postgresTool(options.postgresBin, "pg_restore", ["--exit-on-error", "--single-transaction", "--no-owner", `--dbname=${decodeURIComponent(options.targetUrl.pathname.slice(1))}`, path.join(staging, manifest.database.file)], pgEnvironment(options.targetUrl, options.caFile), options.signal);
		tool.output.resume(); await tool.done;
		await db.query("begin read only; set local timezone='UTC'; set local statement_timeout='300000'");
		const actual = await databaseFingerprints(db, options.signal);
		if (!isDeepStrictEqual(actual, manifest.tables)) throw Error("RESTORED_DATABASE_MISMATCH");
		await db.query("commit");
		await invalidateRestoredAccess(db);
		const objects = path.join(staging, "private-objects"); await mkdir(objects, { mode: 0o700 });
		for (const entry of manifest.objects) {
			const target = path.join(objects, entry.key);
			await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
			await rename(path.join(staging, entry.file), target);
		}
		await rename(objects, path.join(workspace, "private-objects"));
		const migrationRoot = path.join(workspace, "migrations"); await mkdir(migrationRoot, { mode: 0o700 });
		for (const entry of manifest.migrations) await rename(path.join(staging, entry.file), path.join(migrationRoot, entry.migration));
		// Only this final marker makes the recovered set ready for operator inspection.
		const { writeFile } = await import("node:fs/promises");
		await writeFile(path.join(workspace, "verified.json"), JSON.stringify({ schemaVersion: 1, restoredAt: new Date().toISOString(), source: manifest.source, objects: manifest.objects.length, tables: Object.keys(actual).length, oldGuestAccess: "invalidated", scope: "local-database-and-private-files-only; no Auth/Storage service deployment" }), { flag: "wx", mode: 0o600 });
		return { applied: true as const, objects: manifest.objects.length, tables: Object.keys(actual).length, manifest };
	} finally {
		stopCancellation();
		if (connected) await db.query("rollback").catch(() => {}); await db.end().catch(() => {});
	}
	});
}

async function invalidateRestoredAccess(db: ReturnType<typeof databaseClient>) {
	await db.query("begin; set local statement_timeout='30000'");
	try {
		await db.query("update pm.share_links set revoked_at=coalesce(revoked_at,now())");
		await db.query("update pm.guest_sessions set expires_at=least(expires_at,now())");
		await db.query(`update pm.upload_reservations set state='rejected',error_code='RESTORE_REQUIRES_NEW_UPLOAD',processing_token=null,processing_until=null,
		 cleanup_after=greatest(cleanup_after,now()+interval '27 hours') where state in ('reserved','queued','processing')`);
		await db.query("commit");
	} catch (error) { await db.query("rollback"); throw error; }
}

export function recoveryCounts(manifest: BackupManifest) {
	return { objects: manifest.objects.length, bytes: manifest.objects.reduce((n, o) => n + o.bytes, 0), tables: Object.keys(manifest.tables).length, createdAt: manifest.createdAt };
}
