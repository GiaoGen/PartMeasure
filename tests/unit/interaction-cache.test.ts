import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryCache } from "../../src/components/query-cache";
import {
	api,
	clearApiSession,
	invalidateProjectQueries,
	observeApiVersion,
	onApiRevalidate,
	onApiSessionCleared,
	readCached,
	rememberApi,
} from "../../src/components/api";
import { PrivateImageCache } from "../../src/components/image-memory";
import { imagePreviewHint } from "../../src/components/image-preview";

const base = "/api/projects/P";
afterEach(() => {
	clearApiSession();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("interactive reads reuse data without treating stale state as authoritative", () => {
	it("retains display data while a stale read waits, then replaces it and expires within two minutes", async () => {
		vi.useFakeTimers();
		const cache = new QueryCache();
		await cache.read("P", async () => ({ revision: 1 }), 30000);
		vi.advanceTimersByTime(31000);
		expect(cache.peek("P")).toEqual({ revision: 1 });
		let finish: (value: { revision: number }) => void = () => {};
		const reading = cache.read(
			"P",
			() =>
				new Promise<{ revision: number }>((resolve) => {
					finish = resolve;
				}),
			30000,
		);
		expect(cache.peek("P")).toEqual({ revision: 1 });
		finish({ revision: 2 });
		await reading;
		expect(cache.peek("P")).toEqual({ revision: 2 });
		vi.advanceTimersByTime(120001);
		expect(cache.peek("P")).toBeUndefined();
	});
	it("shares the gallery document with the editor and checks changing list fingerprints", async () => {
		const url = `${base}/files/F/annotations`;
		const fetch = vi.fn(async () =>
			Response.json({
				data: {
					image: { id: "F" },
					items: [{ revision: fetch.mock.calls.length }],
				},
			}),
		);
		vi.stubGlobal("fetch", fetch);
		observeApiVersion(url, "list-v1");
		await api(url);
		expect(readCached(url)).toMatchObject({ image: { id: "F" } });
		await api(url);
		expect(fetch).toHaveBeenCalledTimes(1);
		rememberApi(`${base}/files/G/annotations`, { image: { id: "G" }, items: [] });
		observeApiVersion(url, "list-v2");
		expect(readCached(url)).toBeUndefined();
		expect(readCached(`${base}/files/G/annotations`)).toMatchObject({ image: { id: "G" } });
		await api(url);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it("keeps a saved canonical detail on its own realtime echo, but refreshes a newer revision", async () => {
		const fetch = vi.fn(async () => Response.json({ data: { revision: 4 } }));
		vi.stubGlobal("fetch", fetch);
		const url = `${base}/issues/I`;
		rememberApi(url, { revision: 3, responses: [] });
		rememberApi(url, { revision: 2, responses: [] });
		expect(readCached(url)).toMatchObject({ revision: 3 });
		const event = {
			kind: "issue.changed" as const,
			entityId: "I",
			fileId: "F",
			revision: 3,
			sequence: "1",
			state: "submitted",
		};
		invalidateProjectQueries(base, [event]);
		expect(await api(url)).toMatchObject({ revision: 3 });
		expect(fetch).not.toHaveBeenCalled();
		invalidateProjectQueries(base, [{ ...event, revision: 4 }]);
		expect(await api(url)).toEqual({ revision: 4 });
		expect(fetch).toHaveBeenCalledTimes(1);
		clearApiSession();
		expect(readCached(url)).toBeUndefined();
	});
	it("one departing consumer cannot cancel another reader, the last departure cancels transport", async () => {
		const cache = new QueryCache(),
			first = new AbortController(),
			second = new AbortController();
		let transport: AbortSignal | undefined,
			finish: (value: number) => void = () => {};
		const load = vi.fn((signal: AbortSignal) => {
			transport = signal;
			return new Promise<number>((resolve) => {
				finish = resolve;
			});
		});
		const a = cache.read("P", load, 30000, [], 1, { signal: first.signal });
		const b = cache.read("P", load, 30000, [], 1, { signal: second.signal });
		first.abort();
		await expect(a).rejects.toMatchObject({ name: "AbortError" });
		expect(transport?.aborted).toBe(false);
		finish(7);
		expect(await b).toBe(7);
		expect(load).toHaveBeenCalledTimes(1);
		const last = new AbortController();
		const c = cache.read(
			"Q",
			(signal) =>
				new Promise<number>((_resolve, reject) => {
					transport = signal;
					signal.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					});
				}),
			30000,
			[],
			1,
			{ signal: last.signal },
		);
		last.abort();
		await expect(c).rejects.toMatchObject({ name: "AbortError" });
		await Promise.resolve();
		expect(transport?.aborted).toBe(true);
		expect(cache.peek("Q")).toBeUndefined();
	});
	it("returning to a document marks reads stale without evicting displayed data; BFCache is not logout", async () => {
		vi.useFakeTimers();
		const window = new EventTarget(),
			document = Object.assign(new EventTarget(), { hidden: false });
		vi.stubGlobal("window", window);
		vi.stubGlobal("document", document);
		vi.stubGlobal("BroadcastChannel", undefined);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: { revision: 1 } })),
		);
		await api(base);
		const invalid = vi.fn(),
			revalidate = vi.fn();
		const off = onApiSessionCleared(invalid),
			offReturn = onApiRevalidate(revalidate);
		try {
			window.dispatchEvent(
				Object.assign(new Event("pagehide"), { persisted: true }),
			);
			expect(invalid).not.toHaveBeenCalled();
			expect(readCached(base)).toEqual({ revision: 1 });
			window.dispatchEvent(
				Object.assign(new Event("pageshow"), { persisted: true }),
			);
			window.dispatchEvent(new Event("focus"));
			vi.advanceTimersByTime(200);
			expect(revalidate).toHaveBeenCalledTimes(1);
			expect(readCached(base)).toEqual({ revision: 1 });
			await api(base);
			expect(globalThis.fetch).toHaveBeenCalledTimes(2);
		} finally {
			off();
			offReturn();
		}
	});
});

describe("preview transitions lease only bytes already received", () => {
	it("cancels abandoned image transfers but keeps a shared canvas download alive", async () => {
		const images = new PrivateImageCache(1024, 4);
		const first = new AbortController(), second = new AbortController();
		let transport: AbortSignal | undefined, finish: (blob: Blob) => void = () => {};
		const load = vi.fn((signal: AbortSignal) => {
			transport = signal;
			return new Promise<Blob>(resolve => { finish = resolve; });
		});
		const a = images.acquire("canonical", load, first.signal);
		const b = images.acquire("canonical", load, second.signal);
		first.abort(); await expect(a).rejects.toMatchObject({ name: "AbortError" });
		expect(transport?.aborted).toBe(false);
		finish(new Blob(["image"]));
		const lease = await b; lease.release(); expect(load).toHaveBeenCalledTimes(1);
		const last = new AbortController();
		const abandoned = images.acquire("other", signal => new Promise<Blob>((_resolve, reject) => {
			transport = signal;
			signal.addEventListener("abort", () => reject(signal.reason), { once: true });
		}), last.signal);
		last.abort(); await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
		await Promise.resolve(); expect(transport?.aborted).toBe(true);
		images.clear();
	});
	it("uses authorized list hints and keeps a retained thumbnail leased across a view switch", async () => {
		vi.useFakeTimers();
		const hash = "a".repeat(64),
			url = `${base}/files/F/preview`;
		rememberApi(`${base}/files`, {
			items: [
				{
					id: "F",
					previewVersion: `${hash}:n1`,
					thumbnail: { version: "thumb-version" },
				},
			],
		});
		expect(imagePreviewHint(url)).toEqual({
			hash,
			preview: { src: `${url}?variant=640`, version: "thumb-version" },
		});
		const images = new PrivateImageCache(1024, 2, 1000),
			load = vi.fn(async () => new Blob(["image"]));
		const first = await images.acquire("thumb", load);
		first.release();
		const transition = images.cached("thumb");
		expect(transition?.url).toBe(first.url);
		vi.advanceTimersByTime(1001);
		expect(images.cached("missing")).toBeUndefined();
		expect(load).toHaveBeenCalledTimes(1);
		transition?.release();
		images.clear();
		expect(images.cached("thumb")).toBeUndefined();
	});
});
