import { mkdtemp, mkdir, readdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
const database = vi.hoisted(() => vi.fn(() => { throw Error("UNEXPECTED_DATABASE_ACCESS"); }));
vi.mock("../../scripts/maintenance/backup", () => ({ databaseClient: database }));
import { encryptFile } from "../../scripts/maintenance/encrypted-file";
import { manifestSchema } from "../../scripts/maintenance/backup-model";
import { inspectBackup, restoreBackup } from "../../scripts/maintenance/restore";
import { copyBackup } from "../../scripts/maintenance/backup-copy";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); vi.clearAllMocks(); });
async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), "pm-inspect-")); roots.push(root);
	const directory = path.join(root, "archive"); await mkdir(directory);
	const key = randomBytes(32), signal = AbortSignal.timeout(10000);
	const entries = [];
	for (const [file, name, bytes] of [["000001.pmb", "database", "database bytes"], ["000002.pmb", "migration/20261016104229_fixture.sql", "select 1;"]] as const)
		entries.push({ file, name, ...await encryptFile(Readable.from(bytes), path.join(directory, file), name, key, 100, signal) });
	const manifest = manifestSchema.parse({ schemaVersion: 1, source: "disposable-native-fixture", projectRef: "rvysclscetfqicpnzlra", createdAt: "2026-10-27T00:00:00.000Z", serverVersion: "18",
		database: entries[0], objects: [], migrations: [{ ...entries[1], migration: "20261016104229_fixture.sql" }], tables: { projects: { rows: 1, sha256: "a".repeat(64) } },
		coverage: { database: "pm+auth+available-migration-history", objects: "referenced-private-objects-including-hidden-and-history", authSessions: "excluded-and-invalidated", quarantine: "not-included-pending-uploads-rejected-on-restore", secrets: "external-vault-not-included", configuration: "manual-provider-and-SMTP-checklist-required", retention: "operator-managed-7-daily-4-weekly", consistency: "shared-database-snapshot+immutable-private-object-hashes" } });
	await encryptFile(Readable.from(JSON.stringify(manifest)), path.join(directory, "manifest.pmb"), "manifest", key, 10000, signal);
	return { directory, workspace: path.join(root, "inspection"), key, signal };
}
it("authenticates all entries without database credentials, CA, PostgreSQL tools or publishing plaintext", async () => {
	const options = await fixture();
	expect(await inspectBackup(options)).toMatchObject({ applied: false, objects: 0, tables: 1 });
	expect(database).not.toHaveBeenCalled();
	expect(await readdir(options.workspace)).toEqual([]);
});
it("rejects corrupted payload after a valid manifest and removes its private plaintext staging", async () => {
	const options = await fixture(), file = path.join(options.directory, "000002.pmb");
	const bytes = await readFile(file); bytes[23] = (bytes[23] ?? 0) ^ 1; await writeFile(file, bytes);
	await expect(inspectBackup(options)).rejects.toThrow();
	expect(await readdir(options.workspace)).toEqual([]); expect(database).not.toHaveBeenCalled();
});
it("rejects an incomplete real-world layout without a commit manifest, never treating fragments as a complete set", async () => {
	const options = await fixture(); await rm(path.join(options.directory, "manifest.pmb"));
	await expect(inspectBackup(options)).rejects.toMatchObject({ code: "BACKUP_INCOMPLETE" });
	expect(await readdir(options.workspace)).toEqual([]); expect(database).not.toHaveBeenCalled();
});
it("rejects a wrong key and refuses to overwrite an existing inspection directory", async () => {
	const options = await fixture();
	await expect(inspectBackup({ ...options, key: randomBytes(32) })).rejects.toThrow();
	await writeFile(path.join(options.workspace, "keep"), "keep");
	await expect(inspectBackup(options)).rejects.toThrow();
	expect(await readFile(path.join(options.workspace, "keep"), "utf8")).toBe("keep");
});
it("still rejects cloud restoration before creating a workspace or accessing a database", async () => {
	const options = await fixture();
	await expect(restoreBackup({ ...options, targetUrl: new URL("postgresql://postgres@db.example:5432/postgres"), caFile: "unused", postgresBin: "unused", apply: true })).rejects.toThrow("UNAPPROVED_RESTORE_TARGET");
	await expect(stat(options.workspace)).rejects.toThrow(); expect(database).not.toHaveBeenCalled();
});
it("copies only authenticated ciphertext, verifies the copy, and never copies a key or overwrites a destination", async () => {
	const options = await fixture(), root = path.dirname(options.directory);
	await writeFile(path.join(options.directory, "do-not-copy.backup-key"), "secret");
	const destination = path.join(root, "copy"), verificationWorkspace = path.join(root, "copy-check");
	expect(await copyBackup({ ...options, destination, verificationWorkspace })).toMatchObject({ files: 3, keyCopied: false, contentAuthenticated: true, offDeviceLocationCertified: false });
	expect(await readdir(destination)).toEqual(expect.arrayContaining(["manifest.pmb", "000001.pmb", "000002.pmb", "copy-verified.json"]));
	await expect(stat(path.join(destination, "do-not-copy.backup-key"))).rejects.toThrow();
	await expect(copyBackup({ ...options, workspace: path.join(root, "second-check"), destination, verificationWorkspace: path.join(root, "unused-check") })).rejects.toThrow();
	expect(database).not.toHaveBeenCalled();
});
