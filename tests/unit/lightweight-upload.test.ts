import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
vi.mock("server-only", () => ({}));
import { verifySource } from "../../src/lib/server/complete-upload";
const directory = await mkdtemp(path.join(tmpdir(), "pm-light-test-"));
let serial = 0;
const target = () => path.join(directory, `${++serial}`);
afterAll(async () => { if (path.dirname(path.resolve(directory)) === path.resolve(tmpdir()) && path.basename(directory).startsWith("pm-light-test-")) await rm(directory, { recursive: true, force: true }); });
function upload(bytes: Buffer, filename = "test.pdf") { return { byte_size: String(bytes.length), sha256: createHash("sha256").update(bytes).digest("hex"), filename, extension: filename.split(".").at(-1) ?? "", declared_mime: filename.endsWith("pdf") ? "application/pdf" : "image/png" }; }
describe("request upload verification without scanner", () => {
	it("verifies byte count/hash and actual format before accepting private content", async () => {
		const bytes = Buffer.from("%PDF-1.7\nexample"), file = target();
		await verifySource(new Response(bytes), file, upload(bytes));
		expect(await readFile(file)).toEqual(bytes);
	});
	it("rejects forged format, size and hash without requiring a scanner", async () => {
		const bytes = Buffer.from("not a pdf");
		await expect(verifySource(new Response(bytes), target(), upload(bytes))).rejects.toMatchObject({ code: "MAGIC_MISMATCH" });
		const pdf = Buffer.from("%PDF-1.7\nexample"), meta = upload(pdf);
		await expect(verifySource(new Response(pdf), target(), { ...meta, byte_size: "1" })).rejects.toMatchObject({ code: "HASH_OR_SIZE_MISMATCH" });
		await expect(verifySource(new Response(pdf), target(), { ...meta, sha256: "a".repeat(64) })).rejects.toMatchObject({ code: "HASH_OR_SIZE_MISMATCH" });
	});
});
