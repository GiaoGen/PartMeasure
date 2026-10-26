import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { body } from "../../src/lib/server/http";
import { TransferBudget } from "../../src/lib/server/transfer-budget";
import { byteRange } from "../../src/lib/file-range";
import { authFetch } from "../../src/lib/server/auth-fetch";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const schema = z.object({ text: z.string() }).strict();
function request(value: BodyInit, headers: Record<string, string> = {}, signal?: AbortSignal) {
	const init = { method: "POST", body: value, headers: { "content-type": "application/json", ...headers }, signal: signal ?? null, duplex: "half" };
	return new Request("https://app.invalid/api/projects", init);
}
describe("server input and active resource limits", () => {
	it("bounds Auth provider requests and retains caller cancellation", async () => {
		const deadline = new AbortController(), caller = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
		const fetcher = vi.fn(async (_url: unknown, options: RequestInit) => { options.signal?.throwIfAborted(); return new Response("ok"); });
		vi.stubGlobal("fetch", fetcher);
		await authFetch("https://auth.invalid", { signal: caller.signal });
		expect(AbortSignal.timeout).toHaveBeenCalledWith(15000);
		caller.abort();
		await expect(authFetch("https://auth.invalid", { signal: caller.signal })).rejects.toThrow();
		deadline.abort();
		await expect(authFetch("https://auth.invalid")).rejects.toThrow();
	});
	it("accepts JSON with charset but rejects MIME prefixes and oversized declared bodies", async () => {
		await expect(body(request('{"text":"ok"}', { "content-type": "Application/JSON; charset=utf-8" }), schema)).resolves.toEqual({ text: "ok" });
		await expect(body(request('{"text":"ok"}', { "content-type": "application/jsonp" }), schema)).rejects.toMatchObject({ status: 415 });
		await expect(body(request("{}", { "content-length": "65537" }), schema)).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
	});
	it("counts actual streaming bytes even without content length and cancels overflow", async () => {
		const cancel = vi.fn();
		const input = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(32769)); }, cancel });
		await expect(body(request(input), schema)).rejects.toMatchObject({ status: 413 });
		expect(cancel).toHaveBeenCalled();
	});
	it("expires a stalled reader without waiting for an uncooperative upstream cancel", async () => {
		const abort = new AbortController();
		const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(abort.signal);
		const input = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } });
		const pending = body(request(input), schema);
		abort.abort();
		await expect(pending).rejects.toMatchObject({ code: "REQUEST_TIMEOUT", status: 408 });
		expect(timeout).toHaveBeenCalledWith(15000);
	});
	it("enforces total and actor budgets and releases each slot only once", () => {
		const budget = new TransferBudget(3, 2);
		const a = budget.acquire("A"), b = budget.acquire("A"), c = budget.acquire("B");
		expect(() => budget.acquire("A")).toThrowError(expect.objectContaining({ code: "TRANSFER_BUSY" }));
		expect(() => budget.acquire("C")).toThrow();
		a(); a();
		const d = budget.acquire("C");
		expect(() => budget.acquire("D")).toThrow();
		b(); c(); d();
		budget.acquire("A")();
	});
	it("calculates bounded suffix/open/clipped ranges without unsafe number conversion", () => {
		expect(byteRange("bytes=-9999999999999999999999999", 8)).toEqual({ start: 0, end: 7, bytes: 8 });
		expect(byteRange("bytes=2-9999999999999999999999999", 8)).toEqual({ start: 2, end: 7, bytes: 6 });
		expect(byteRange("bytes=5-", 8)).toEqual({ start: 5, end: 7, bytes: 3 });
		expect(byteRange("bytes=8-", 8)).toBeNull();
	});
});
