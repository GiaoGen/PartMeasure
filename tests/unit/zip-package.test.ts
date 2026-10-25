import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../src/components/api", async (original) => ({
	...(await original<object>()),
	apiSessionGuard: vi.fn(() => vi.fn()),
	readApiTransport: vi.fn(),
}));
import { readApiTransport } from "../../src/components/api";
import { sampleZipPackage } from "../fixtures/zip-package";
import {
	parseZipSelection,
	zipSelectionQuery,
	safeZipFilename,
	checkZipSnapshot,
	zipLimits,
} from "../../src/lib/zip-package";
import { crc32, storedZip } from "../../src/lib/stored-zip";
import {
	generateZipPackage,
	zipBinary,
	verifyZipAccess,
	sha256Bytes,
} from "../../src/components/generate-zip-package";
const time = "2026-10-25T13:00:00Z";
beforeEach(() => vi.mocked(readApiTransport).mockReset());
it("round-trips exact selection and rejects duplicates, extra fields and empty/draft requests", async () => {
	const { snapshot } = await sampleZipPackage();
	expect(
		parseZipSelection(
			new URLSearchParams(zipSelectionQuery(snapshot.selection)),
		),
	).toEqual(snapshot.selection);
	const id = snapshot.files[0]?.id;
	for (const query of [
		"",
		`materials=${id},${id}`,
		`materials=${id}&draft=1`,
		`attachments=${id}`,
		`materials=${id}&originals=yes`,
		`materials=${id}&materials=${id}`,
	])
		expect(() => parseZipSelection(new URLSearchParams(query))).toThrow(
			"INVALID_INPUT",
		);
});
it("keeps readable Chinese filenames and extensions while preventing paths/device names", () => {
	expect(safeZipFilename("../CON.sldprt")).not.toMatch(/[/:\\]|^\./);
	expect(safeZipFilename("CON.sldprt")).toBe("file_CON.sldprt");
	const name = safeZipFilename(`${"中文".repeat(100)}.SLDPRT`);
	expect(name.endsWith(".SLDPRT")).toBe(true);
	expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200);
});
it("CRC32 is standard and identical when computed in bounded chunks", () => {
	const bytes = new TextEncoder().encode("123456789");
	expect(crc32(bytes)).toBe(0xcbf43926);
	expect(crc32(bytes.subarray(4), crc32(bytes.subarray(0, 4)))).toBe(
		crc32(bytes),
	);
});
it("rejects ZIP path traversal and duplicate entries", () => {
	const blob = new Blob(["x"]),
		signal = new AbortController().signal;
	for (const path of [
		"../secret",
		"/absolute",
		"C:/drive",
		"a\\b",
		"a/../b",
		"a//b",
	])
		expect(() =>
			storedZip([{ path, data: blob, crc: 0 }], time, signal),
		).toThrow("ZIP_LIMIT");
	expect(() =>
		storedZip(
			[
				{ path: "x", data: blob, crc: 0 },
				{ path: "x", data: blob, crc: 0 },
			],
			time,
			signal,
		),
	).toThrow("ZIP_LIMIT");
});
it("has explicit entry, data and byte bounds and cancellation", async () => {
	const { snapshot } = await sampleZipPackage();
	const first = snapshot.files[0];
	if (!first) throw Error("FIXTURE");
	first.byteSize = zipLimits.bytes;
	expect(() => checkZipSnapshot(snapshot)).toThrow("ZIP_LIMIT");
	const controller = new AbortController();
	controller.abort();
	expect(() => storedZip([], time, controller.signal)).toThrow();
});
it("requires every final file identity, hash and length", async () => {
	const { snapshot } = await sampleZipPackage();
	expect(() =>
		verifyZipAccess(snapshot.files, snapshot.files.slice(1)),
	).toThrow("ZIP_SOURCE_CHANGED");
	expect(() =>
		verifyZipAccess(
			snapshot.files,
			snapshot.files.map((file, n) =>
				n ? file : { ...file, sha256: "b".repeat(64) },
			),
		),
	).toThrow("ZIP_SOURCE_CHANGED");
});
it("reads the exact tail after an 8MiB boundary and cancels a partial file", async () => {
	const { snapshot } = await sampleZipPackage(),
		first = snapshot.files[0];
	if (!first) throw Error("FIXTURE");
	const bytes = new Uint8Array(8 * 1024 * 1024 + 3).fill(0x7e);
	bytes.set([1, 2, 3], bytes.length - 3);
	const file = {
		...first,
		byteSize: bytes.length,
		sha256: await sha256Bytes(bytes),
	};
	const reads: string[] = [],
		controller = new AbortController();
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, options: RequestInit) => {
			const range = new Headers(options.headers).get("range") ?? "";
			reads.push(range);
			const parts = /bytes=(\d+)-(\d+)/.exec(range);
			if (!parts) throw Error("RANGE");
			const start = Number(parts[1]),
				end = Number(parts[2]);
			return new Response(bytes.slice(start, end + 1), {
				status: 206,
				headers: { "content-range": `bytes ${start}-${end}/${bytes.length}` },
			});
		}),
	);
	try {
		const result = await zipBinary(
			"/api/projects/P",
			file,
			controller.signal,
			vi.fn(),
		);
		expect(reads).toEqual(["bytes=0-8388607", "bytes=8388608-8388610"]);
		expect(result.crc).toBe(crc32(bytes));
		expect(result.data.size).toBe(bytes.length);
		reads.length = 0;
		await expect(
			zipBinary("/api/projects/P", file, controller.signal, (received) => {
				if (received >= 8388608) controller.abort();
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(reads).toHaveLength(1);
	} finally {
		vi.unstubAllGlobals();
	}
});
it("assembles all verified bytes and refuses a corrupted range or revoked final access", async () => {
	const fixture = await sampleZipPackage(),
		{ snapshot } = fixture;
	const fetcher = vi.fn(async (url: string, options: RequestInit) => {
		const file = snapshot.files.find(
			(file) =>
				url.includes(file.id) &&
				(url.includes("original=1")
					? file.variant === "original"
					: file.variant !== "original"),
		);
		if (!file) throw Error("FIXTURE_FILE");
		const bytes = fixture.bytes.get(file.path);
		if (!bytes) throw Error("FIXTURE_BYTES");
		const range = new Headers(options.headers).get("range") ?? "";
		expect(range).toBe(`bytes=0-${bytes.length - 1}`);
		return new Response(bytes, {
			status: 206,
			headers: {
				"content-range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
			},
		});
	});
	vi.stubGlobal("fetch", fetcher);
	try {
		vi.mocked(readApiTransport)
			.mockResolvedValueOnce(snapshot)
			.mockResolvedValueOnce({ files: snapshot.files });
		const result = await generateZipPackage(
			"/api/projects/P",
			snapshot.selection,
			new AbortController().signal,
			vi.fn(),
		);
		expect(result.blob.type).toBe("application/zip");
		expect(
			new DataView(await result.blob.arrayBuffer()).getUint32(0, true),
		).toBe(0x04034b50);
		result.release();
		vi.mocked(readApiTransport)
			.mockResolvedValueOnce(snapshot)
			.mockResolvedValueOnce({ files: snapshot.files.slice(1) });
		await expect(
			generateZipPackage(
				"/api/projects/P",
				snapshot.selection,
				new AbortController().signal,
				vi.fn(),
			),
		).rejects.toMatchObject({ code: "ZIP_SOURCE_CHANGED" });
		fetcher.mockImplementationOnce(
			async (_url, _options) =>
				new Response(new Uint8Array(snapshot.files[0]?.byteSize ?? 0), {
					status: 206,
					headers: {
						"content-range": `bytes 0-${(snapshot.files[0]?.byteSize ?? 1) - 1}/${snapshot.files[0]?.byteSize}`,
					},
				}),
		);
		const first = snapshot.files[0];
		if (!first) throw Error("FIXTURE");
		await expect(
			zipBinary(
				"/api/projects/P",
				first,
				new AbortController().signal,
				vi.fn(),
			),
		).rejects.toMatchObject({ code: "ZIP_SOURCE_CHANGED" });
	} finally {
		vi.unstubAllGlobals();
	}
});
