import { describe, it, expect, vi, afterEach } from "vitest";
import { PrivateImageCache } from "../../src/components/private-image-cache";
afterEach(() => vi.restoreAllMocks());
describe("private tab-memory image leases", () => {
	it("coalesces concurrent consumers and reuses an immutable version", async () => {
		const cache = new PrivateImageCache(100),
			load = vi.fn(async () => new Blob(["small"]));
		const [a, b] = await Promise.all([
			cache.acquire("owner:P:file:hash", load),
			cache.acquire("owner:P:file:hash", load),
		]);
		expect(a.url).toBe(b.url);
		expect(load).toHaveBeenCalledTimes(1);
		a.release();
		b.release();
		const c = await cache.acquire("owner:P:file:hash", load);
		expect(c.url).toBe(a.url);
		c.release();
		cache.clear();
	});
	it("evicts only released leases and rejects exceeding the memory budget", async () => {
		const revoke = vi.spyOn(URL, "revokeObjectURL"),
			cache = new PrivateImageCache(8, 2);
		const a = await cache.acquire("A", async () => new Blob(["123456"]));
		await expect(cache.acquire("B", async () => new Blob(["6789"]))).rejects.toThrow(
			"IMAGE_CACHE_BUSY",
		);
		a.release();
		const b = await cache.acquire("B", async () => new Blob(["6789"]));
		expect(revoke).toHaveBeenCalledWith(a.url);
		b.release();
		cache.clear();
	});
	it("fences an in-flight response on logout instead of repopulating old identity", async () => {
		const cache = new PrivateImageCache();
		let complete: (blob: Blob) => void = () => {};
		const loading = cache.acquire(
			"old",
			() =>
				new Promise<Blob>((resolve) => {
					complete = resolve;
				}),
		);
		cache.clear();
		complete(new Blob(["private"]));
		await expect(loading).rejects.toMatchObject({ status: 401 });
	});
});
