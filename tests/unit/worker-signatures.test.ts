import { describe, it, expect } from "vitest";
import { signatureHeader, loadedSignatureVersion } from "../../src/lib/worker-signatures";
const now = 1792400000000,
	header = (timestamp: number) =>
		`ClamAV-VDB:date:28155:355765:1:checksum:sig:builder:${timestamp}`;
describe("supervised worker safety preflight", () => {
	it("uses signed database build time, rather than a copied file's fresh mtime", () => {
		expect(signatureHeader(header(Math.floor(now / 1000) - 3600), now).version).toBe(28155);
		expect(() => signatureHeader(header(Math.floor(now / 1000) - 73 * 3600), now)).toThrow(
			"SCANNER_SIGNATURES_STALE",
		);
		expect(() => signatureHeader(header(Math.floor(now / 1000) + 1000), now)).toThrow();
	});
	it("requires clamd to actually have loaded the expected daily version", () => {
		expect(() => loadedSignatureVersion("ClamAV 1.5.4/28155/date", 28155)).not.toThrow();
		expect(() => loadedSignatureVersion("ClamAV 1.5.4/28154/date", 28155)).toThrow(
			"SCANNER_RELOAD_REQUIRED",
		);
		expect(() => loadedSignatureVersion("invalid", 28155)).toThrow();
	});
});
