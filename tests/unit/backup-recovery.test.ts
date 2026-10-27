import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { encryptFile, decryptFile } from "../../scripts/maintenance/encrypted-file";
import { restoreAllowed, sourceAllowed } from "../../scripts/maintenance/backup-model";
const directory = await mkdtemp(path.join(tmpdir(), "pm-backup-unit-"));
const key = randomBytes(32), signal = new AbortController().signal;
let serial = 0;
const name = () => path.join(directory, `${++serial}`);
afterAll(async () => { const absolute = path.resolve(directory); if (path.dirname(absolute) === path.resolve(tmpdir()) && path.basename(absolute).startsWith("pm-backup-unit-")) await rm(absolute, { recursive: true, force: true }); });
describe("authenticated private backup files", () => {
	it("round trips streamed bytes with independent IVs and exact size/hash", async () => {
		const bytes = randomBytes(200000), first = name(), second = name(), decoded = name();
		const expected = await encryptFile(Readable.from([bytes.subarray(0, 100000), bytes.subarray(100000)]), first, "object/private/file", key, bytes.length, signal);
		await encryptFile(Readable.from(bytes), second, "object/private/file", key, bytes.length, signal);
		expect(await readFile(first)).not.toEqual(await readFile(second));
		expect(await decryptFile(first, decoded, "object/private/file", key, expected, bytes.length, signal)).toEqual(expected);
		expect(await readFile(decoded)).toEqual(bytes);
	});
	it("rejects wrong keys, renamed logical entries and corrupted ciphertext; removes partial plaintext", async () => {
		const encrypted = name();
		const expected = await encryptFile(Readable.from("private payload"), encrypted, "database", key, 100, signal);
		for (const [label, decryptKey] of [["other", key], ["database", randomBytes(32)]] as const) {
			const target = name();
			await expect(decryptFile(encrypted, target, label, decryptKey, expected, 100, signal)).rejects.toThrow();
			await expect(stat(target)).rejects.toThrow();
		}
		const corrupted = await readFile(encrypted); corrupted[23] = (corrupted[23] ?? 0) ^ 1; await writeFile(encrypted, corrupted);
		await expect(decryptFile(encrypted, name(), "database", key, expected, 100, signal)).rejects.toThrow();
	});
	it("does not remove or overwrite a pre-existing encrypted or plaintext destination", async () => {
		const existing = name(), encrypted = name(); await writeFile(existing, "keep");
		await expect(encryptFile(Readable.from("x"), existing, "database", key, 100, signal)).rejects.toThrow();
		expect(await readFile(existing, "utf8")).toBe("keep");
		const fp = await encryptFile(Readable.from("x"), encrypted, "database", key, 100, signal);
		await expect(decryptFile(encrypted, existing, "database", key, fp, 100, signal)).rejects.toThrow();
		expect(await readFile(existing, "utf8")).toBe("keep");
	});
	it("stops oversized input, truncation and metadata mismatch without publishing plaintext", async () => {
		const file = name();
		await expect(encryptFile(Readable.from("oversize"), file, "database", key, 1, signal)).rejects.toThrow("BACKUP_SIZE_LIMIT");
		await expect(stat(file)).rejects.toThrow();
		const good = name(), target = name(); const fp = await encryptFile(Readable.from("ok"), good, "database", key, 100, signal);
		await expect(decryptFile(good, target, "database", key, { ...fp, sha256: "0".repeat(64) }, 100, signal)).rejects.toThrow("BACKUP_HASH_MISMATCH");
		await expect(stat(target)).rejects.toThrow();
		await writeFile(good, (await readFile(good)).subarray(0, 12));
		await expect(decryptFile(good, name(), "database", key, fp, 100, signal)).rejects.toThrow("INVALID_BACKUP_SIZE");
	});
	it("restricts automated restore to a new local sandbox name and backup to the isolated source", () => {
		expect(restoreAllowed(new URL("postgresql://postgres@127.0.0.1:55448/pm_restore_aabbccddeeff"))).toBe(true);
		for (const url of ["postgresql://postgres@127.0.0.1:55448/postgres", "postgresql://postgres@127.0.0.1:5432/pm_restore_aabbccddeeff", "postgresql://postgres@db.example/pm_restore_aabbccddeeff"])
			expect(restoreAllowed(new URL(url))).toBe(false);
		expect(sourceAllowed(new URL("postgresql://postgres.other@a.pooler.supabase.com:5432/postgres"), false)).toBe(false);
		const allowed = "postgresql://postgres.rvysclscetfqicpnzlra:test@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres";
		expect(sourceAllowed(new URL(allowed), false)).toBe(true);
		for (const value of [allowed.replace("postgresql:", "https:"), `${allowed}?host=other.example`, `${allowed}?sslmode=disable`, allowed.replace("/postgres", "/other")])
			expect(sourceAllowed(new URL(value), false)).toBe(false);
		expect(restoreAllowed(new URL("http://postgres@127.0.0.1:55448/pm_restore_aabbccddeeff"))).toBe(false);
		expect(restoreAllowed(new URL("postgresql://postgres@127.0.0.1:55448/pm_restore_aabbccddeeff?host=other.example"))).toBe(false);
	});
});
