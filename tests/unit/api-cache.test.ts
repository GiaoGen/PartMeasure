import { afterEach, describe, expect, it, vi } from "vitest";
import { api, clearApiSession } from "../../src/components/api";
import { QueryCache } from "../../src/components/query-cache";

const json = (data: unknown, status = 200) => Response.json({ data }, { status });
const failure = (code: string, status: number) => Response.json({ error: { code } }, { status });
const token = "a".repeat(43);
afterEach(() => { clearApiSession(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("browser request sharing and CSRF", () => {
	it("coalesces simultaneous reads and isolates caller mutations", async () => {
		const fetch = vi.fn(async () => json({ items: [1] }));
		vi.stubGlobal("fetch", fetch);
		const [a, b] = await Promise.all([api<{ items: number[] }>("/api/projects/P/files"), api<{ items: number[] }>("/api/projects/P/files")]);
		expect(fetch).toHaveBeenCalledTimes(1);
		a.items.push(2);
		expect(b.items).toEqual([1]);
	});
	it("scopes cache by exact role/project/query/version and expires short entries", async () => {
		vi.useFakeTimers();
		const fetch = vi.fn(async () => json({ value: 1 }));
		vi.stubGlobal("fetch", fetch);
		const read = (url: string, version = "1") => api(url, "GET", undefined, { cacheMs: 1000, cacheVersion: version });
		await read("/api/projects/P/files"); await read("/api/projects/P/files");
		await read("/api/guest/projects/P/files"); await read("/api/projects/Q/files");
		await read("/api/projects/P/files?q=a"); await read("/api/projects/P/files", "2");
		expect(fetch).toHaveBeenCalledTimes(5);
		vi.advanceTimersByTime(1001);
		await read("/api/projects/P/files");
		expect(fetch).toHaveBeenCalledTimes(6);
	});
	it("shares one CSRF request across concurrent writes and reuses it", async () => {
		const fetch = vi.fn(async (url: string) => json(url === "/api/csrf" ? { token } : { saved: true }));
		vi.stubGlobal("fetch", fetch);
		await Promise.all([api("/api/projects/P", "PATCH", {}), api("/api/projects/Q", "PATCH", {})]);
		await api("/api/projects/P", "PATCH", {});
		expect(fetch.mock.calls.filter(([url]) => url === "/api/csrf")).toHaveLength(1);
		expect(fetch).toHaveBeenCalledTimes(4);
	});
	it("retries only explicit CSRF rejection once with the same key/body", async () => {
		const operations: RequestInit[] = [];
		const fetch = vi.fn(async (url: string, init: RequestInit) => {
			if (url === "/api/csrf") return json({ token });
			operations.push(structuredClone(init));
			return operations.length === 1 ? failure("CSRF_INVALID", 403) : json({ saved: true });
		});
		vi.stubGlobal("fetch", fetch);
		await api("/api/projects/P", "PATCH", { name: "kept" }, { key: "same-operation" });
		expect(operations).toHaveLength(2);
		expect(operations[0]?.body).toBe(operations[1]?.body);
		expect(new Headers(operations[0]?.headers).get("Idempotency-Key")).toBe("same-operation");
		expect(new Headers(operations[1]?.headers).get("Idempotency-Key")).toBe("same-operation");
	});
	it.each([["FORBIDDEN", 403], ["DEPENDENCY_UNAVAILABLE", 503]])("never retries %s writes", async (code, status) => {
		const fetch = vi.fn(async (url: string) => url === "/api/csrf" ? json({ token }) : failure(code, status));
		vi.stubGlobal("fetch", fetch);
		await expect(api("/api/projects/P", "PATCH", {})).rejects.toMatchObject({ code });
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it("invalidates reads on mutation and on denied authorization", async () => {
		let denied = false;
		const fetch = vi.fn(async (url: string) => url === "/api/csrf" ? json({ token }) : denied ? failure("LINK_UNAVAILABLE", 401) : json({ saved: true }));
		vi.stubGlobal("fetch", fetch);
		await api("/api/projects/P/files", "GET", undefined, { cacheMs: 1000 });
		await api("/api/projects/P", "PATCH", {});
		await api("/api/projects/P/files", "GET", undefined, { cacheMs: 1000 });
		denied = true;
		await expect(api("/api/guest/projects/P")).rejects.toMatchObject({ status: 401, code: "LINK_UNAVAILABLE" });
		await expect(api("/api/projects/P/files", "GET", undefined, { cacheMs: 1000 })).rejects.toMatchObject({ status: 401 });
	});
	it("rejects a previous identity's late response", async () => {
		let finish: ((value: Response) => void) | undefined;
		vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
		const pending = api("/api/projects/P/files");
		clearApiSession();
		finish?.(json({ private: "old-session" }));
		await expect(pending).rejects.toMatchObject({ status: 401 });
	});
});

describe("bounded query memory", () => {
	it("does not repopulate cache with an invalidated late read", async () => {
		const cache = new QueryCache();
		let finish: ((value: number) => void) | undefined;
		const old = cache.read("P", () => new Promise<number>(r => { finish = r; }), 1000);
		cache.clear();
		finish?.(1); await old;
		expect(await cache.read("P", async () => 2, 1000)).toBe(2);
	});
	it("evicts entries within the memory limit and never caches errors", async () => {
		const cache = new QueryCache(1, 100);
		await cache.read("P", async () => 1, 1000);
		await cache.read("Q", async () => 2, 1000);
		expect(await cache.read("P", async () => 3, 1000)).toBe(3);
		await expect(cache.read("E", async () => { throw Error("failed"); }, 1000)).rejects.toThrow();
		expect(await cache.read("E", async () => 4, 1000)).toBe(4);
	});
	it("a zero-TTL explicit reload bypasses a retained response", async () => {
		const cache = new QueryCache();
		await cache.read("P", async () => "old", 1000);
		expect(await cache.read("P", async () => "new", 0)).toBe("new");
	});
});
