import { describe, expect, it } from "vitest";
import {
	MiB,
	sniff,
	uploadInput,
	uploadPolicy,
	validateZip,
} from "../../src/lib/policy";
describe("upload trust boundary", () => {
	it.each(["heic", "svg", "gif", "exe", "mp4"])(
		"refuses unsupported .%s",
		(ext) => {
			expect(() => uploadPolicy(`a.${ext}`, 10, "")).toThrow(
				"UNSUPPORTED_FORMAT",
			);
		},
	);
	it.each([
		["a.jpg", 20],
		["a.png", 20],
		["a.webp", 20],
		["a.pdf", 50],
		["a.step", 100],
		["a.zip", 100],
	])("enforces size of %s", (name, size) => {
		expect(() =>
			uploadPolicy(String(name), Number(size) * MiB + 1, ""),
		).toThrow("FILE_TOO_LARGE");
	});
	it("does not trust MIME or extension", () => {
		expect(() => uploadPolicy("photo.png", 10, "image/jpeg")).toThrow(
			"MIME_MISMATCH",
		);
		expect(() => sniff(Buffer.from("%PDF-1.7"), "png")).toThrow(
			"MAGIC_MISMATCH",
		);
	});
	it.each([
		"../a.png",
		"a.exe.pdf",
		"a\u0000.png",
		"a\\b.png",
		`${"中".repeat(90)}.png`,
	])("refuses unsafe names", (filename) => {
		expect(
			uploadInput.safeParse({
				filename,
				byteSize: 1,
				declaredMime: "",
				sha256: "a".repeat(64),
			}).success,
		).toBe(false);
	});
	it("accepts text CAD headers and rejects executable camouflage", () => {
		expect(() =>
			sniff(Buffer.from("ISO-10303-21;\nHEADER;"), "step"),
		).not.toThrow();
		expect(() => sniff(Buffer.from("MZ executable"), "step")).toThrow();
	});
	it("rejects binary STL with a forged triangle count", () => {
		const bytes = Buffer.alloc(84);
		bytes.writeUInt32LE(10, 80);
		expect(() => sniff(bytes, "stl")).toThrow();
	});
	it("reserves derivative budget and rejects unknown input fields", () => {
		expect(uploadPolicy("a.jpg", 10, "image/jpeg").budget).toBe(80 * MiB + 10);
		expect(
			uploadInput.safeParse({
				filename: "a.png",
				byteSize: 10,
				declaredMime: "image/png",
				sha256: "a".repeat(64),
				ownerId: "forged",
			}).success,
		).toBe(false);
	});
	it("rejects encrypted, traversal and excessive ZIP archives before scanning", () => {
		function zip(name: string, flags = 0, unpacked = 10) {
			const n = Buffer.from(name),
				b = Buffer.alloc(46 + n.length + 22);
			b.writeUInt32LE(0x02014b50, 0);
			b.writeUInt16LE(flags, 8);
			b.writeUInt32LE(10, 20);
			b.writeUInt32LE(unpacked, 24);
			b.writeUInt16LE(n.length, 28);
			n.copy(b, 46);
			const end = 46 + n.length;
			b.writeUInt32LE(0x06054b50, end);
			b.writeUInt16LE(1, end + 10);
			b.writeUInt32LE(end, end + 12);
			return b;
		}
		expect(() => validateZip(zip("drawing.txt"))).not.toThrow();
		expect(() => validateZip(zip("drawing.txt", 1))).toThrow("ZIP_UNSAFE");
		expect(() => validateZip(zip("../evil.txt"))).toThrow("ZIP_UNSAFE");
		expect(() => validateZip(zip("large.txt", 0, 201 * MiB))).toThrow(
			"ZIP_UNSAFE",
		);
	});
});
