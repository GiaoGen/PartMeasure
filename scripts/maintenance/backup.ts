import pg from "pg";
import { Readable } from "node:stream";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { encryptFile, type Fingerprint } from "./encrypted-file";
import { backupLimits, manifestSchema, sourceAllowed, objectKey, type ObjectReference, type BackupManifest } from "./backup-model";
import { databaseFingerprints, pgEnvironment, postgresTool, cancelDatabaseOnAbort, guardSnapshotSession } from "./postgres-tools";
import { privateDirectory } from "./private-directory";

export type BackupOptions = { sourceUrl: URL; caFile: string; postgresBin: string; directory: string; key: Buffer; native: boolean;
	readObject: (key: string, signal: AbortSignal) => Promise<Readable>; signal: AbortSignal;
	onProgress?: (progress: { phase: "connecting" | "snapshot" | "database" | "objects" | "migrations" | "manifest"; completed?: number; total?: number }) => void };
export function databaseClient(url: URL, ca: string) {
	const safe = new URL(url); safe.searchParams.delete("sslmode");
	return new pg.Client({ connectionString: safe.href, ssl: { rejectUnauthorized: true, ca }, connectionTimeoutMillis: 10000, query_timeout: 300000 });
}
export async function objectReferences(db: pg.Client): Promise<ObjectReference[]> {
	const refs = await db.query<{ key: string; bytes: string; sha256: string; mime: string }>(`select key,bytes,sha256,mime from (
	 select storage_key as key,byte_size as bytes,sha256,mime from pm.file_assets
	 union select original_key,original_bytes,original_sha256,'application/octet-stream' from pm.file_assets
	 union select storage_key,byte_size,sha256,'image/webp' from pm.image_derivatives
	) r order by key limit $1`, [backupLimits.objects + 1]);
	const unique = new Map<string, ObjectReference>();
	for (const row of refs.rows) {
		const value = { ...row, bytes: Number(row.bytes) };
		if (!objectKey.safeParse(row.key).success || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > backupLimits.objectBytes || !/^[a-f0-9]{64}$/.test(row.sha256)) throw Error("INVALID_OBJECT_REFERENCE");
		const previous = unique.get(row.key);
		if (previous && (previous.bytes !== value.bytes || previous.sha256 !== value.sha256)) throw Error("CONFLICTING_OBJECT_REFERENCE");
		unique.set(row.key, value);
	}
	if (refs.rows.length > backupLimits.objects || [...unique.values()].reduce((n, r) => n + r.bytes, 0) > backupLimits.totalBytes - backupLimits.databaseBytes) throw Error("BACKUP_SIZE_LIMIT");
	return [...unique.values()];
}
export async function createBackup(options: BackupOptions): Promise<BackupManifest> {
	if (!sourceAllowed(options.sourceUrl, options.native)) throw Error("UNAPPROVED_BACKUP_SOURCE");
	options.signal.throwIfAborted();
	await privateDirectory(options.directory);
	const db = databaseClient(options.sourceUrl, await readFile(options.caFile, "utf8"));
	const snapshotSession = guardSnapshotSession(db, options.signal);
	options = { ...options, signal: snapshotSession.signal };
	const stopCancellation = cancelDatabaseOnAbort(db, options.signal);
	let connected = false;
	let serial = 0;
	const encrypt = async (name: string, stream: Readable, max: number) => {
		const file = `${String(++serial).padStart(6, "0")}.pmb`;
		return { file, name, ...await encryptFile(stream, path.join(options.directory, file), name, options.key, max, options.signal) };
	};
	try {
		options.onProgress?.({ phase: "connecting" });
		await db.connect();
		connected = true;
		await db.query("begin isolation level repeatable read read only");
		await db.query("set local timezone='UTC'; set local statement_timeout='300000'; set local lock_timeout='5000'; set local idle_in_transaction_session_timeout='1500000'");
		const snapshot = (await db.query<{ snapshot: string; time: Date; version: string }>("select pg_export_snapshot() as snapshot,transaction_timestamp() as time,current_setting('server_version') as version")).rows[0];
		if (!snapshot) throw Error("SNAPSHOT_UNAVAILABLE");
		options.onProgress?.({ phase: "snapshot" });
		const refs = await objectReferences(db);
		const tables = await databaseFingerprints(db, options.signal);
		const schemas = (await db.query<{ nspname: string }>("select nspname from pg_namespace where nspname in ('pm','auth','supabase_migrations') order by nspname")).rows;
		options.onProgress?.({ phase: "database" });
		const dump = postgresTool(options.postgresBin, "pg_dump", ["--format=custom", "--no-owner", "--lock-wait-timeout=5000", `--snapshot=${snapshot.snapshot}`,
			...schemas.map(s => `--schema=${s.nspname}`), ...["sessions", "refresh_tokens", "one_time_tokens", "flow_state", "mfa_challenges", "saml_relay_states"].map(table => `--exclude-table-data=auth.${table}`)], pgEnvironment(options.sourceUrl, options.caFile), options.signal);
		let database: Awaited<ReturnType<typeof encrypt>>;
		try { database = await encrypt("database", dump.output, backupLimits.databaseBytes); await dump.done; }
		catch (error) { dump.stop(); throw error; }
		const objects: BackupManifest["objects"] = [];
		options.onProgress?.({ phase: "objects", completed: 0, total: refs.length });
		for (const ref of refs) {
			options.signal.throwIfAborted();
			const artifact = await encrypt(`object/partmeasure-private/${ref.key}`, await options.readObject(ref.key, options.signal), ref.bytes);
			assertHash(artifact, ref);
			objects.push({ ...artifact, bucket: "partmeasure-private", key: ref.key, mime: ref.mime });
			if (objects.length % 10 === 0 || objects.length === refs.length) options.onProgress?.({ phase: "objects", completed: objects.length, total: refs.length });
		}
		const migrations: BackupManifest["migrations"] = [];
		options.onProgress?.({ phase: "migrations" });
		for (const name of (await readdir("supabase/migrations")).filter(n => /^\d{14}_[a-z0-9_]+\.sql$/.test(n)).sort()) {
			migrations.push({ ...await encrypt(`migration/${name}`, Readable.from(await readFile(path.join("supabase/migrations", name))), 4 * 1024 ** 2), migration: name });
		}
		const manifest = manifestSchema.parse({ schemaVersion: 1, source: options.native ? "disposable-native-fixture" : "isolated-supabase", projectRef: "rvysclscetfqicpnzlra", createdAt: snapshot.time.toISOString(), serverVersion: snapshot.version,
			database, objects, migrations, tables,
			coverage: { database: "pm+auth+available-migration-history", objects: "referenced-private-objects-including-hidden-and-history", authSessions: "excluded-and-invalidated", quarantine: "not-included-pending-uploads-rejected-on-restore", secrets: "external-vault-not-included", configuration: "manual-provider-and-SMTP-checklist-required", retention: "operator-managed-7-daily-4-weekly", consistency: "shared-database-snapshot+immutable-private-object-hashes" } });
		await db.query("commit");
		options.onProgress?.({ phase: "manifest" });
		// The manifest is the commit marker. Incomplete runs cannot be restored.
		await encryptFile(Readable.from(Buffer.from(JSON.stringify(manifest))), path.join(options.directory, "manifest.pmb"), "manifest", options.key, backupLimits.manifestBytes, options.signal);
		return manifest;
	} catch (error) {
		if (snapshotSession.signal.aborted) throw snapshotSession.signal.reason;
		throw error;
	} finally { stopCancellation(); if (connected) await db.query("rollback").catch(() => {}); await db.end().catch(() => {}); snapshotSession.stop(); }
}
export function assertHash(actual: Fingerprint, expected: Fingerprint) {
	if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw Error("BACKUP_HASH_MISMATCH");
}
