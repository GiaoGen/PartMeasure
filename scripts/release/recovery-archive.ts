// One complete-set authentication + archive inventory; packages ciphertext only.
import assert from "node:assert/strict";
import path from "node:path";
import { createReadStream } from "node:fs";
import { readFile, writeFile, readdir, realpath, lstat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { authenticatedBackup } from "../maintenance/restore";
import { backupKey } from "../maintenance/encrypted-file";
import { privateDirectory } from "../maintenance/private-directory";
import { postgresTool } from "../maintenance/postgres-tools";

const scope = JSON.parse(await readFile("docs/evidence/p3-05/recovery-backup-scope.json", "utf8"));
assert.match(scope.run, /^[a-f0-9-]{36}$/);
const state = JSON.parse(await readFile(`tmp/fix-e/${scope.run}/state.json`, "utf8"));
assert.equal(state.backupAttempt, "complete");
assert.match(state.setId, /^[a-f0-9-]{36}$/);
const source = await realpath(state.environment.PM_BACKUP_SET);
assert.equal(source, await realpath(`tmp/backups/${state.setId}`));
const key = await backupKey(state.environment.PM_BACKUP_KEY_FILE);
const directory = `tmp/p3-05/recovery-archive-${randomUUID()}`;
await privateDirectory(directory);
await writeFile("tmp/p3-05/recovery-archive.pending", JSON.stringify({ sourceSet: state.setId, directory }), { flag: "wx" });
const signal = AbortSignal.timeout(5 * 60 * 1000);
const result = await authenticatedBackup({ directory: source, workspace: path.resolve(directory, "authenticate"), key, signal }, async ({ manifest, staging }) => {
	const expected = ["manifest.pmb", manifest.database.file, ...manifest.objects.map(v => v.file), ...manifest.migrations.map(v => v.file)].sort();
	const actual = (await readdir(source)).sort();
	assert.deepEqual(actual, expected, "UNEXPECTED_SET_FILES_NO_UPLOAD");
	for (const file of actual) {
		assert.match(file, /^(?:manifest|\d{6})\.pmb$/);
		const full = path.join(source, file), info = await lstat(full);
		assert.ok(info.isFile() && !info.isSymbolicLink());
		assert.equal(path.dirname(await realpath(full)), source);
	}
	const inventory = postgresTool(state.environment.PM_POSTGRES_BIN, "pg_restore", ["--list", path.join(staging, manifest.database.file)], process.env, signal);
	let toc = "";
	try {
		for await (const chunk of inventory.output) { toc += String(chunk); if (Buffer.byteLength(toc) > 2 * 1024 * 1024) throw Error("ARCHIVE_INDEX_LIMIT"); }
		await inventory.done;
	} catch (error) { inventory.stop(); throw error; }
	const lines = toc.split(/\r?\n/);
	const business = lines.filter(line => /^\d+;\s+\d+\s+\d+\s+TABLE DATA\s+pm\s+/.test(line));
	assert.equal(business.length, Object.keys(manifest.tables).length);
	assert.equal(business.length, 24);
	for (const table of ["users", "identities"]) assert.ok(lines.some(line => new RegExp(`TABLE DATA\\s+auth\\s+${table}\\s+`).test(line)));
	for (const table of ["sessions", "refresh_tokens", "one_time_tokens", "flow_state", "mfa_challenges", "saml_relay_states"])
		assert.ok(!lines.some(line => new RegExp(`TABLE DATA\\s+auth\\s+${table}\\s+`).test(line)));
	const zip = path.resolve(directory, `PartMeasure-V1-${scope.run}.zip`);
	// Both paths are passed in child-only environment; no shell-built file command or secret.
	const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:PM_ARCHIVE_SOURCE,$env:PM_ARCHIVE_OUTPUT,[System.IO.Compression.CompressionLevel]::NoCompression,$false)"], {
		env: { ...process.env, PM_ARCHIVE_SOURCE: source, PM_ARCHIVE_OUTPUT: zip }, windowsHide: true, stdio: "ignore", signal,
	});
	await new Promise<void>((resolve, reject) => { child.once("error", () => reject(Error("CIPHERTEXT_ARCHIVE_FAILED"))); child.once("close", code => code === 0 ? resolve() : reject(Error("CIPHERTEXT_ARCHIVE_FAILED"))); });
	const sha = createHash("sha256"), md5 = createHash("md5"); let bytes = 0;
	for await (const chunk of createReadStream(zip, { signal })) { bytes += chunk.length; sha.update(chunk); md5.update(chunk); }
	return { zip, bytes, sha256: sha.digest("hex"), md5: md5.digest("hex"), sourceCreatedAt: manifest.createdAt, files: expected.length,
		tables: business.length, objects: manifest.objects.length, migrations: manifest.migrations.length,
		authUsersAndIdentitiesIncluded: true, activeAuthCapabilityDataExcluded: true, keyIncluded: false, allPlaintextHashesAndGcmAuthenticated: true };
});
await writeFile(path.join(directory, "artifact.json"), JSON.stringify({ run: scope.run, sourceSet: state.setId, ...result }, null, 2));
await writeFile("tmp/p3-05/recovery-archive.json", JSON.stringify({ run: scope.run, sourceSet: state.setId, directory, ...result }, null, 2), { flag: "wx" });
const { zip, ...publicResult } = result;
await writeFile("docs/evidence/p3-05/recovery-backup-authentication.json", `${JSON.stringify({ checkedAt: new Date().toISOString(), status: "PASS", run: scope.run, sourceSet: state.setId, ...publicResult, scope: "Actual complete source set offline authentication and ciphertext ZIP. No off-device/target restore/key custody claim." }, null, 2)}\n`);
console.log(JSON.stringify({ status: "PASS", sourceSet: state.setId, ...publicResult }));
