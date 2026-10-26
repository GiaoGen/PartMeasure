import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const magic = Buffer.from("PMBAK01\0");
const headerBytes = magic.length + 12;
const tagBytes = 16;
export type Fingerprint = { bytes: number; sha256: string };
export async function backupKey(file: string) {
	const data = (await readFile(file, "utf8")).trim();
	if (!/^[0-9a-f]{64}$/i.test(data)) throw Error("INVALID_BACKUP_KEY");
	return Buffer.from(data, "hex");
}

/** Each file authenticates its logical name as well as its bytes. Never reuse IVs. */
export async function encryptFile(source: Readable, target: string, name: string, key: Buffer, maxBytes: number, signal: AbortSignal): Promise<Fingerprint> {
	if (key.length !== 32) throw Error("INVALID_BACKUP_KEY");
	const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
	cipher.setAAD(Buffer.from(name));
	const hash = createHash("sha256"); let bytes = 0, created = false;
	const out = createWriteStream(target, { flags: "wx", mode: 0o600 });
	out.once("open", () => { created = true; });
	try {
		const encrypted = Readable.from((async function* () {
			yield Buffer.concat([magic, iv]);
			for await (const value of source) {
				signal.throwIfAborted();
				const chunk = Buffer.from(value); bytes += chunk.length;
				if (bytes > maxBytes) throw Error("BACKUP_SIZE_LIMIT");
				hash.update(chunk); yield cipher.update(chunk);
			}
			yield cipher.final(); yield cipher.getAuthTag();
		})());
		await pipeline(encrypted, out, { signal });
		return { bytes, sha256: hash.digest("hex") };
	} catch (error) {
		source.destroy(); if (created) await unlink(target).catch(() => {}); throw error;
	}
}

/** Decrypt only into a private staging directory; GCM must authenticate before use. */
export async function decryptFile(source: string, target: string, name: string, key: Buffer, expected: Fingerprint | null, maxBytes: number, signal: AbortSignal): Promise<Fingerprint> {
	const info = await stat(source);
	if (!info.isFile() || info.size < headerBytes + tagBytes || info.size - headerBytes - tagBytes > maxBytes) throw Error("INVALID_BACKUP_SIZE");
	const input = await open(source, "r");
	const header = Buffer.alloc(headerBytes), tag = Buffer.alloc(tagBytes);
	try {
		await input.read(header, 0, headerBytes, 0);
		await input.read(tag, 0, tagBytes, info.size - tagBytes);
	} finally { await input.close(); }
	if (!header.subarray(0, magic.length).equals(magic)) throw Error("INVALID_BACKUP_FORMAT");
	const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(magic.length));
	decipher.setAAD(Buffer.from(name)); decipher.setAuthTag(tag);
	const hash = createHash("sha256"); let bytes = 0;
	const measure = new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; hash.update(chunk); callback(null, chunk); } });
	let created = false;
	const output = createWriteStream(target, { flags: "wx", mode: 0o600 });
	output.once("open", () => { created = true; });
	try {
		const encryptedBytes = info.size - headerBytes - tagBytes;
		const stream = encryptedBytes ? createReadStream(source, { start: headerBytes, end: info.size - tagBytes - 1 }) : Readable.from([]);
		await pipeline(stream, decipher, measure, output, { signal });
		const actual = { bytes, sha256: hash.digest("hex") };
		if (expected && (expected.bytes !== bytes || expected.sha256 !== actual.sha256)) throw Error("BACKUP_HASH_MISMATCH");
		return actual;
	} catch (error) { if (created) await unlink(target).catch(() => {}); throw error; }
}
