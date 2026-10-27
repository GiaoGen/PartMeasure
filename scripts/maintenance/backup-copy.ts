import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { authenticatedBackup, inspectBackup, type InspectOptions } from "./restore";
import { privateDirectory } from "./private-directory";

async function ciphertextHash(file: string, signal: AbortSignal) {
	const hash = createHash("sha256"); let bytes = 0;
	for await (const chunk of createReadStream(file, { signal })) { hash.update(chunk); bytes += chunk.length; }
	return { bytes, sha256: hash.digest("hex") };
}
/** Copies ciphertext only into a NEW private destination, then authenticates the copy independently. */
export async function copyBackup(options: InspectOptions & { destination: string; verificationWorkspace: string }) {
	return authenticatedBackup(options, async ({ manifest }) => {
		const source = await realpath(options.directory), destination = path.resolve(options.destination);
		if (source === destination || destination.startsWith(`${source}${path.sep}`) || source.startsWith(`${destination}${path.sep}`)) throw Error("BACKUP_COPY_PATH_OVERLAP");
		await privateDirectory(destination);
		const actualDestination = await realpath(destination);
		const files = ["manifest.pmb", manifest.database.file, ...manifest.objects.map(entry => entry.file), ...manifest.migrations.map(entry => entry.file)];
		const index = [];
		for (const file of files) {
			options.signal.throwIfAborted();
			const input = path.join(source, file), output = path.join(actualDestination, file), info = await lstat(input);
			if (!info.isFile() || info.isSymbolicLink() || path.dirname(await realpath(input)) !== source) throw Error("UNSAFE_BACKUP_PATH");
			const before = await ciphertextHash(input, options.signal);
			await copyFile(input, output, constants.COPYFILE_EXCL);
			const after = await ciphertextHash(output, options.signal), stable = await ciphertextHash(input, options.signal);
			if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(before) !== JSON.stringify(stable)) throw Error("BACKUP_COPY_MISMATCH");
			index.push({ file, ...after });
		}
		const authenticated = await inspectBackup({ directory: actualDestination, workspace: options.verificationWorkspace, key: options.key, signal: options.signal });
		const result = { schemaVersion: 1, copiedAt: new Date().toISOString(), sourceCreatedAt: manifest.createdAt, files: index.length,
			ciphertextBytes: index.reduce((total, file) => total+file.bytes, 0), objects: authenticated.objects, tables: authenticated.tables,
			contentAuthenticated: true, ciphertextIdentityVerified: true, keyCopied: false, offDeviceLocationCertified: false };
		await writeFile(path.join(actualDestination, "copy-verified.json"), `${JSON.stringify({ ...result, index })}\n`, { flag: "wx", mode: 0o600 });
		return result;
	});
}
