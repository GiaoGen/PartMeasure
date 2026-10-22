import { afterEach, describe, expect, it, vi } from "vitest";
import { api, clearApiSession, invalidateProjectQueries } from "../../src/components/api";
import { eventTags, queryPolicy } from "../../src/components/cache-policy";
import { PrivateImageCache, boundedImageBlob } from "../../src/components/image-memory";
import { privateImage } from "../../src/components/private-image-cache";
import { ImageTransfers } from "../../src/components/image-transfers";
import { QueryCache } from "../../src/components/query-cache";
import type { ProjectEvent } from "../../src/lib/project-events";
const base = "/api/projects/P",
	guest = "/api/guest/projects/P";
const event = (
	kind: ProjectEvent["kind"],
	entityId = "I",
	fileId: string | null = "F",
): ProjectEvent => ({ kind, entityId, fileId, sequence: "1", revision: 1, state: "ready" });
const json = (value: unknown) => Response.json({ data: value });
afterEach(() => {
	clearApiSession();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});
describe("project cache boundaries", () => {
	it("tracks an issue's actual evidence dependencies without evicting unrelated issue details", async () => {
		const fetch = vi.fn(async (url: string) =>
			json({ responses: [{ attachments: [{ id: url.endsWith("/I") ? "F" : "G" }] }] }),
		);
		vi.stubGlobal("fetch", fetch);
		await api(`${base}/issues/I`);
		await api(`${base}/issues/J`);
		invalidateProjectQueries(base, [event("file.changed", "F", "F")]);
		await api(`${base}/issues/I`);
		await api(`${base}/issues/J`);
		expect(fetch).toHaveBeenCalledTimes(3);
	});
	it("bounds distinct in-flight metadata reads without sending overflow requests", async () => {
		const cache = new QueryCache(1);
		let finish: (v: number) => void = () => {};
		const first = cache.read(
				"A",
				() =>
					new Promise<number>((r) => {
						finish = r;
					}),
			),
			load = vi.fn(async () => 2);
		await expect(cache.read("B", load)).rejects.toThrow("同时读取");
		expect(load).not.toHaveBeenCalled();
		finish(1);
		await first;
		expect(await cache.read("B", load)).toBe(2);
	});
	it("aborts metadata transport on logout and still fences clients that ignore cancellation", async () => {
		let finish: (r: Response) => void = () => {},
			signal: AbortSignal | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn((_url: string, init: RequestInit) => {
				signal = init.signal as AbortSignal;
				return new Promise<Response>((r) => {
					finish = r;
				});
			}),
		);
		const pending = api(base);
		clearApiSession();
		expect(signal?.aborted).toBe(true);
		finish(json({ private: "old" }));
		await expect(pending).rejects.toMatchObject({ status: 401 });
	});
	it("an issue event refreshes its detail/lists, keeps other issues/projects/files/deliveries", async () => {
		const fetch = vi.fn(async () => json({ revision: 1 }));
		vi.stubGlobal("fetch", fetch);
		const urls = [
			`${base}/issues/I`,
			`${base}/issues/J`,
			`${base}/issues`,
			`${base}/issues?fileId=F`,
			`${base}/issues?fileId=G`,
			`${base}/files`,
			`${base}/deliveries`,
			`/api/projects/Q/issues/I`,
		];
		for (const url of urls) await api(url);
		invalidateProjectQueries(base, [{ ...event("issue.changed"), revision: 2 }]);
		for (const url of urls) await api(url);
		expect(fetch).toHaveBeenCalledTimes(urls.length + 3);
		expect(queryPolicy(`${base}/changes`).ttl).toBe(0);
		expect(eventTags(base, [{ kind: "resync" }])).toContain(base);
	});
	it("a mutation keeps unrelated project caches and a resync is confined to one role/project", async () => {
		const fetch = vi.fn(async (url: string) =>
			json(url === "/api/csrf" ? { token: "a".repeat(43) } : { revision: 1 }),
		);
		vi.stubGlobal("fetch", fetch);
		await api(base);
		await api("/api/projects/Q");
		await api(guest);
		await api(base, "PATCH", { name: "updated" });
		await api("/api/projects/Q");
		await api(guest);
		expect(fetch).toHaveBeenCalledTimes(5);
		invalidateProjectQueries(base, [{ kind: "resync" }]);
		await api(base);
		await api(guest);
		expect(fetch).toHaveBeenCalledTimes(6);
	});
	it("an event fences a late response and joins the authoritative replacement read", async () => {
		let finish: (r: Response) => void = () => {};
		const fetch = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<Response>((r) => {
						finish = r;
					}),
			)
			.mockImplementation(async () => json({ revision: 2 }));
		vi.stubGlobal("fetch", fetch);
		const old = api(`${base}/issues/I`);
		invalidateProjectQueries(base, [event("issue.changed")]);
		expect(await api(`${base}/issues/I`)).toEqual({ revision: 2 });
		finish(json({ revision: 1 }));
		expect(await old).toEqual({ revision: 2 });
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it("successful cookie switching also rejects reads begun during login", async () => {
		let finishLogin: (r: Response) => void = () => {},
			finishOld: (r: Response) => void = () => {},
			loginSeen = false;
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string) =>
				url === "/api/csrf"
					? Promise.resolve(json({ token: "a".repeat(43) }))
					: url === "/api/auth/login"
						? new Promise<Response>((r) => {
								finishLogin = r;
								loginSeen = true;
							})
						: new Promise<Response>((r) => {
								finishOld = r;
							}),
			),
		);
		const login = api("/api/auth/login", "POST", {});
		await vi.waitFor(() => expect(loginSeen).toBe(true));
		const old = api(base);
		finishLogin(json({ signedIn: true }));
		await login;
		finishOld(json({ private: "A" }));
		await expect(old).rejects.toMatchObject({ status: 401 });
	});
});
describe("image memory and identity fences", () => {
	it("bounds queued transfers and removes aborted waiters without consuming a slot", async () => {
		const gate = new ImageTransfers(1, 1),
			first = new AbortController(),
			queued = new AbortController();
		let finish: () => void = () => {};
		const active = gate.run(
			first.signal,
			() =>
				new Promise<void>((r) => {
					finish = r;
				}),
		);
		const work = vi.fn(async () => {}),
			waiting = gate.run(queued.signal, work);
		await expect(gate.run(first.signal, work)).rejects.toThrow("IMAGE_CACHE_BUSY");
		queued.abort();
		await expect(waiting).rejects.toBeDefined();
		const next = gate.run(first.signal, work);
		finish();
		await active;
		await next;
		expect(work).toHaveBeenCalledTimes(1);
	});
	it("reserves in-flight encoded bytes and rejects budget overflow before a second body", async () => {
		const cache = new PrivateImageCache(10);
		let finish: (b: Blob) => void = () => {};
		const a = cache.acquire("A", async (_s, reserve) => {
			reserve(6);
			return new Promise<Blob>((r) => {
				finish = r;
			});
		});
		await expect(
			cache.acquire("B", async (_s, reserve) => {
				reserve(5);
				return new Blob(["12345"]);
			}),
		).rejects.toThrow("IMAGE_CACHE_BUSY");
		finish(new Blob(["123456"]));
		(await a).release();
		cache.clear();
	});
	it("actively releases idle URLs without another cache request", async () => {
		vi.useFakeTimers();
		const revoke = vi.spyOn(URL, "revokeObjectURL"),
			cache = new PrivateImageCache(100, 2, 1000);
		const value = await cache.acquire("A", async () => new Blob(["a"]));
		value.release();
		vi.advanceTimersByTime(1001);
		expect(revoke).toHaveBeenCalledWith(value.url);
		cache.clear();
	});
	it("aborts one invalidated project without disturbing other images or accepting its late load", async () => {
		const cache = new PrivateImageCache();
		let finish: (b: Blob) => void = () => {},
			signal: AbortSignal | undefined;
		const a = cache.acquire("A/F/hash", async (s) => {
			signal = s;
			return new Promise<Blob>((r) => {
				finish = r;
			});
		});
		const load = vi.fn(async () => new Blob(["b"])),
			b = await cache.acquire("B/F/hash", load);
		b.release();
		cache.invalidate((key) => key.startsWith("A/"));
		expect(signal?.aborted).toBe(true);
		finish(new Blob(["a"]));
		await expect(a).rejects.toMatchObject({ status: 409 });
		(await cache.acquire("B/F/hash", load)).release();
		expect(load).toHaveBeenCalledTimes(1);
		cache.clear();
	});
	it("enforces response length while consuming and cancels a lying/oversized stream", async () => {
		const reserve = vi.fn(),
			controller = new AbortController();
		await expect(
			boundedImageBlob(
				new Response("12345", { headers: { "content-length": "4" } }),
				controller.signal,
				reserve,
			),
		).rejects.toThrow("IMAGE_CACHE_LIMIT");
		expect(reserve).toHaveBeenCalledWith(4);
	});
	it("retains immutable images on metadata resync, clears only revoked Guest project and clears all on logout", async () => {
		const fetch = vi.fn(
			async () =>
				new Response("abcd", {
					headers: { "content-type": "image/webp", "content-length": "4" },
				}),
		);
		vi.stubGlobal("fetch", fetch);
		const read = async (b: string) => {
			const v = await privateImage(`${b}/files/F/preview`, "hash");
			v.release();
		};
		await read(guest);
		await read("/api/guest/projects/Q");
		invalidateProjectQueries(guest, [{ kind: "resync" }]);
		await read(guest);
		expect(fetch).toHaveBeenCalledTimes(2);
		invalidateProjectQueries(guest, [event("access.changed")]);
		await read(guest);
		await read("/api/guest/projects/Q");
		expect(fetch).toHaveBeenCalledTimes(3);
		clearApiSession();
		await read(guest);
		expect(fetch).toHaveBeenCalledTimes(4);
	});
});
