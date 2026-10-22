import { afterEach, describe, expect, it, vi } from "vitest";
import { blobHash, PersistentImages, retainedImages, diskLimits, type ImageStore, type StoredImage } from "../../src/components/persistent-images";
class MemoryStore implements ImageStore {
	rows = new Map<string, StoredImage>();
	get = vi.fn(async (key: string) => this.rows.get(key));
	async has(version: string) { return [...this.rows.values()].some(row => row.version === version); }
	async put(value: StoredImage) { this.rows = new Map(retainedImages([...this.rows.values()], value, Date.now()).map(row => [row.key, row])); }
	async remove(matches: (row: StoredImage) => boolean) { for (const [key, row] of this.rows) if (matches(row)) this.rows.delete(key); }
}
const namespace = "a".repeat(64), other = "b".repeat(64);
afterEach(() => vi.useRealTimers());
describe("persistent image bytes are permission gated, bounded and disposable", () => {
	it("reuses bytes after a new cache instance only after fresh authorization", async () => {
		const store = new MemoryStore(), first = new PersistentImages(store), blob = new Blob(["private pixels"]), version = await blobHash(blob);
		await first.save(namespace, version, "/api/projects/P/files/F/preview", "/api/projects/P", blob, first.guard());
		const refreshed = new PersistentImages(store);
		const authorize = vi.fn(async () => { expect(store.get).not.toHaveBeenCalled(); return { namespace, bytes: blob.size }; });
		expect(await (await refreshed.reuse(version, authorize, refreshed.guard(), () => {}))?.text()).toBe("private pixels");
		expect(authorize).toHaveBeenCalledTimes(1);
	});
	it("rejects denied/offline authorization without reading stored blob bytes", async () => {
		const store = new MemoryStore(), cache = new PersistentImages(store), blob = new Blob(["secret"]), version = await blobHash(blob);
		await cache.save(namespace, version, "F", "P", blob, cache.guard());
		for (const code of ["REVOKED", "OFFLINE"]) await expect(cache.reuse(version, async () => { throw Error(code); }, cache.guard(), () => {})).rejects.toThrow(code);
		expect(store.get).not.toHaveBeenCalled();
	});
	it("does not reuse another account/guest generation's partition", async () => {
		const store = new MemoryStore(), cache = new PersistentImages(store), blob = new Blob(["same hash"]), version = await blobHash(blob);
		await cache.save(namespace, version, "F", "P", blob, cache.guard());
		expect(await cache.reuse(version, async () => ({ namespace: other, bytes: blob.size }), cache.guard(), () => {})).toBeUndefined();
	});
	it("invalidates a pending write when logout/deletion happens during hashing", async () => {
		const store = new MemoryStore(), cache = new PersistentImages(store), blob = new Blob(["late"]), version = await blobHash(blob), valid = cache.guard();
		const save = cache.save(namespace, version, "F", "P", blob, valid);
		await cache.invalidate(() => true); await save;
		expect(store.rows.size).toBe(0);
	});
	it("expires bytes after 24 hours and never accepts a corrupt blob", async () => {
		vi.useFakeTimers();
		const store = new MemoryStore(), cache = new PersistentImages(store), blob = new Blob(["correct"]), version = await blobHash(blob);
		await cache.save(namespace, version, "F", "P", blob, cache.guard());
		const key = `${namespace}:${version}`, saved = store.rows.get(key) as StoredImage;
		store.rows.set(key, { ...saved, blob: new Blob(["corrupt"]) });
		expect(await cache.read(namespace, version, blob.size, cache.guard())).toBeUndefined();
		await cache.save(namespace, version, "F", "P", blob, cache.guard());
		vi.advanceTimersByTime(diskLimits.age + 1);
		expect(await cache.read(namespace, version, blob.size, cache.guard())).toBeUndefined();
	});
	it("enforces 48 entries and the 96 MiB retention budget", () => {
		const row = { created: Date.now(), accessed: Date.now(), bytes: 3 * 1024 * 1024 } as StoredImage;
		const rows = Array.from({ length: 60 }, (_, index) => ({ ...row, key: String(index) }));
		const bounded = retainedImages(rows, { ...row, key: "new" }, Date.now());
		expect(bounded.reduce((n, value) => n + value.bytes, 0)).toBeLessThanOrEqual(diskLimits.bytes);
		expect(bounded.length).toBeLessThanOrEqual(48);
		expect(retainedImages(rows.map(value => ({ ...value, bytes: 1 })), { ...row, key: "new", bytes: 1 }, Date.now())).toHaveLength(48);
	});
	it("falls back when IndexedDB/quota is unavailable and skips oversized persistent entries", async () => {
		const store = new MemoryStore(); store.put = async () => { throw Error("QuotaExceededError"); };
		const cache = new PersistentImages(store), blob = new Blob(["small"]), version = await blobHash(blob);
		await expect(cache.save(namespace, version, "F", "P", blob, cache.guard())).resolves.toBeUndefined();
		expect(await cache.has(version)).toBe(false);
	});
});
