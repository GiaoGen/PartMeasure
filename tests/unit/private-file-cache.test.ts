import { beforeEach, describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ sign: vi.fn() }));
vi.mock("../../src/lib/server/storage", () => ({
	privateBucket: "private",
	storage: () => ({ from: () => ({ createSignedUrl: mocks.sign }) }),
}));
vi.mock("../../src/lib/server/timing", () => ({
	timed: (_n: string, run: () => unknown) => run(),
}));
import { fileResponse } from "../../src/lib/server/file-response";
import { ThumbnailCache } from "../../src/lib/server/thumbnail-cache";
const bytes = new TextEncoder().encode("abcd");
let serial = 0;
const fixture = () => ({
	mime: "image/webp",
	filename: "image.jpg",
	byte_size: "4",
	original_bytes: "4",
	storage_key: `P/F${++serial}/thumb-640.webp`,
	original_key: "P/original",
	sha256: createHash("sha256").update(bytes).digest("hex"),
});
beforeEach(() => {
	mocks.sign
		.mockReset()
		.mockResolvedValue({
			data: { signedUrl: "https://storage.invalid/ephemeral" },
			error: null,
		});
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(bytes)),
	);
});
describe("private server byte cache (unit authorization boundary)", () => {
	it("rechecks authorization on a warm hit; a revoked or other-project caller receives no bytes", async () => {
		const file = fixture(),
			authorize = vi.fn(async () => file),
			req = () => new Request("https://app.invalid/preview");
		const first = await fileResponse(req(), authorize, true);
		expect(await first.text()).toBe("abcd");
		const second = await fileResponse(req(), authorize, true);
		expect(await second.text()).toBe("abcd");
		expect(authorize).toHaveBeenCalledTimes(4);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(second.headers.get("cache-control")).toBe("private, no-store");
		expect(second.headers.get("location")).toBeNull();
		const denied = vi.fn(async () => {
			throw Error("REVOKED_OR_OTHER_PROJECT");
		});
		await expect(fileResponse(req(), denied, true)).rejects.toThrow("REVOKED_OR_OTHER_PROJECT");
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it("does not retain mismatched hashes or failed loads", async () => {
		const file = { ...fixture(), sha256: "0".repeat(64) };
		for (let i = 0; i < 2; i++)
			await expect(
				fileResponse(new Request("https://app.invalid/preview"), async () => file, true),
			).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it("keeps Range and canonical image transfers streaming rather than buffering/caching them", async () => {
		const file = fixture();
		for (let i = 0; i < 2; i++) {
			const res = await fileResponse(
				new Request("https://app.invalid/preview", { headers: { Range: "bytes=0-1" } }),
				async () => file,
				true,
			);
			await res.arrayBuffer();
		}
		const canonical = { ...file, storage_key: "P/F/canonical.webp" };
		for (let i = 0; i < 2; i++)
			await (
				await fileResponse(
					new Request("https://app.invalid/preview"),
					async () => canonical,
					true,
				)
			).arrayBuffer();
		expect(fetch).toHaveBeenCalledTimes(4);
	});
	it("bounds retained bytes/count, isolates copies and expires cached data", async () => {
		vi.useFakeTimers();
		try {
			const cache = new ThumbnailCache(6, 1, 1000),
				load = vi.fn(async () => bytes);
			const a = await cache.read("A", load);
			if (a) a[0] = 0;
			expect(new TextDecoder().decode((await cache.read("A", load)) ?? undefined)).toBe("abcd");
			await cache.read("B", load);
			await cache.read("A", load);
			expect(load).toHaveBeenCalledTimes(3);
			vi.advanceTimersByTime(1001);
			await cache.read("A", load);
			expect(load).toHaveBeenCalledTimes(4);
		} finally {
			vi.useRealTimers();
		}
	});
});
