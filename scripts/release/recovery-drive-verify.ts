// Authenticate the ciphertext retrieved from the single approved Drive upload.
// Operator downloads via the authenticated Drive UI; no bearer URL handling.
import assert from "node:assert/strict";
import path from "node:path";
import { createReadStream } from "node:fs";
import { readFile, writeFile, readdir, realpath, lstat } from "node:fs/promises";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { privateDirectory } from "../maintenance/private-directory";
import { backupKey } from "../maintenance/encrypted-file";
import { inspectBackup } from "../maintenance/restore";

async function main() {
	const archive = JSON.parse(await readFile("tmp/p3-05/recovery-archive.json", "utf8"));
	const drive = JSON.parse(await readFile("tmp/p3-05/recovery-drive-state.json", "utf8"));
	assert.equal(drive.uploadAttempt, "complete");
	assert.equal(process.argv.length, 4, "REQUIRES_DOWNLOADED_ZIP_AND_PHONE_RETURN_KEY_PATHS");
	const zipArgument = process.argv[2], keyArgument = process.argv[3];
	assert.ok(zipArgument && keyArgument);
	const zip = await realpath(zipArgument);
	const phoneKeyFile = await realpath(keyArgument);
	assert.ok((await lstat(zip)).isFile());
	assert.notEqual(zip, await realpath(archive.zip), "MUST_USE_DRIVE_DOWNLOAD_NOT_ORIGINAL");
	const state = JSON.parse(await readFile(`tmp/fix-e/${archive.run}/state.json`, "utf8"));
	assert.notEqual(phoneKeyFile, await realpath(state.environment.PM_BACKUP_KEY_FILE), "MUST_USE_INDEPENDENT_PHONE_RETURN_KEY");
	const key = await backupKey(phoneKeyFile);
	const originalKey = await backupKey(state.environment.PM_BACKUP_KEY_FILE);
	assert.ok(timingSafeEqual(key, originalKey), "PHONE_RETURN_KEY_MISMATCH"); originalKey.fill(0);
	const workspace = path.resolve(`tmp/p3-05/recovery-drive-${randomUUID()}`);
	await privateDirectory(workspace);
	await writeFile("tmp/p3-05/recovery-drive-verify.pending", JSON.stringify({ workspace, fileId: drive.fileId }), { flag: "wx" });
	const signal = AbortSignal.timeout(5 * 60 * 1000);
	let bytes = 0; const sha = createHash("sha256");
	for await (const chunk of createReadStream(zip, { signal })) {
		bytes += chunk.length;
		assert.ok(bytes <= archive.bytes, "DRIVE_DOWNLOAD_SIZE_LIMIT"); sha.update(chunk);
	}
	assert.equal(bytes, archive.bytes); const sha256 = sha.digest("hex");
	assert.equal(sha256, archive.sha256, "DRIVE_CIPHERTEXT_HASH_MISMATCH");
	const directory = path.join(workspace, "downloaded-set");
	// Extraction follows exact SHA256 equality with our own generated archive.
	const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:PM_COPY_ZIP,$env:PM_COPY_SET)"], {
		env: { ...process.env, PM_COPY_ZIP: zip, PM_COPY_SET: directory }, stdio: "ignore", windowsHide: true, signal,
	});
	await new Promise<void>((resolve, reject) => { child.once("error", () => reject(Error("COPY_EXTRACTION_FAILED"))); child.once("close", code => code === 0 ? resolve() : reject(Error("COPY_EXTRACTION_FAILED"))); });
	assert.equal((await readdir(directory)).length, archive.files);
	const restored = await inspectBackup({ directory, workspace: path.join(workspace, "authenticate"), key, signal });
	key.fill(0);
	assert.equal(restored.tables, archive.tables); assert.equal(restored.objects, archive.objects);
	const result = { checkedAt: new Date().toISOString(), status: "PASS", fileId: drive.fileId, folderId: drive.folderId,
		archiveBytes: bytes, sha256, files: archive.files, ...restored, allDownloadedFilesGcmAndHashesAuthenticated: true,
		keyIncluded: false, phoneKeyCustodyVerified: true, cloudRestored: false,
		scope: "Operator-reported authenticated Drive UI download; exact original ciphertext hash and all downloaded-file authentication using independently returned phone key. Phone custody origin relies on operator confirmation." };
	await writeFile("tmp/p3-05/recovery-drive-verified.json", JSON.stringify({ ...result, workspace, directory, zip }, null, 2), { flag: "wx" });
	await writeFile("docs/evidence/p3-05/recovery-drive-verification.json", `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
	console.log(JSON.stringify(result));
}
main().catch(error => {
	// Never emit key contents or private path-bearing exception messages.
	const e = error as { code?: string; cause?: { code?: string }; name?: string };
	console.error(JSON.stringify({ status: "FAIL", name: e.name, code: e.code, causeCode: e.cause?.code })); process.exitCode = 1;
});
