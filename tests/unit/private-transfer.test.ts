import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const sign = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/server/storage", () => ({ privateBucket: "private", storage: () => ({ from: () => ({ createSignedUrl: sign }) }) }));
import { fileResponse } from "../../src/lib/server/file-response";
const file = { mime: "application/pdf", filename: "part.pdf", byte_size: "4", original_bytes: "4", storage_key: "P/F/source", original_key: "P/F/source", sha256: "a".repeat(64), transfer_scope: "owner:A" };
const req = (signal?: AbortSignal) => new Request("https://app.invalid/download", { signal: signal ?? null });
beforeEach(() => { sign.mockResolvedValue({ data: { signedUrl: "https://storage.invalid/ephemeral" }, error: null }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });
it("records only fixed stage/code and byte progress for an interrupted diagnostic stream", async () => {
	vi.stubEnv("PM_SERVER_TIMING", "1");
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ pull() { throw Error("private https://host/s/capability?secret=password"); } }, { highWaterMark: 0 }))));
	const response = await fileResponse(req(), async () => file);
	await expect(response.text()).rejects.toThrow("PRIVATE_DOWNLOAD_INTERRUPTED");
	expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: "private_transfer_interrupted", phase: "read", code: "STREAM_INTERRUPTED", receivedBytes: 0, expectedBytes: 4, nextBytes: 0, upstreamDone: false, aborted: false }));
	expect(JSON.stringify(warn.mock.calls)).not.toMatch(/capability|secret|password/);
});
it("denies a revocation committed during Storage fetch before any response is returned", async () => {
	let permitted = true;
	vi.stubGlobal("fetch", vi.fn(async () => { permitted = false; return new Response("abcd"); }));
	const authorize = async () => { if (!permitted) throw Error("LINK_UNAVAILABLE"); return file; };
	await expect(fileResponse(req(), authorize)).rejects.toThrow("LINK_UNAVAILABLE");
});
it("rechecks before the next chunk after a long wait and stops the source on revocation", async () => {
	vi.useFakeTimers();
	let permitted = true;
	const cancel = vi.fn();
	vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode("ab")); }, cancel }, { highWaterMark: 0 }))));
	const response = await fileResponse(req(), async () => { if (!permitted) throw Error("LINK_UNAVAILABLE"); return file; });
	const reader = response.body?.getReader();
	await expect(reader?.read()).resolves.toMatchObject({ done: false });
	permitted = false;
	vi.advanceTimersByTime(5001);
	await expect(reader?.read()).rejects.toThrow("PRIVATE_DOWNLOAD_INTERRUPTED");
	expect(cancel).toHaveBeenCalled();
});
it.each(["abc", "abcde"])("rejects truncated or excessive upstream bytes (%s)", async bytes => {
	vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
	const response = await fileResponse(req(), async () => file);
	await expect(response.text()).rejects.toThrow("PRIVATE_DOWNLOAD_INTERRUPTED");
});
it("enforces a lifetime even when a client never consumes the response", async () => {
	vi.useFakeTimers();
	vi.stubGlobal("fetch", vi.fn(async () => new Response("abcd")));
	const responses = await Promise.all(Array.from({ length: 8 }, () => fileResponse(req(), async () => file)));
	await expect(fileResponse(req(), async () => file)).rejects.toMatchObject({ code: "TRANSFER_BUSY" });
	vi.advanceTimersByTime(60001);
	for (const response of responses) await expect(response.text()).rejects.toThrow("PRIVATE_DOWNLOAD_INTERRUPTED");
	const next = await fileResponse(req(), async () => file);
	expect(await next.text()).toBe("abcd");
});
it("validates upstream partial response headers and keeps Range after fresh authorization", async () => {
	vi.stubGlobal("fetch", vi.fn(async () => new Response("bc", { status: 206, headers: { "Content-Range": "bytes 1-2/4", "Content-Length": "2" } })));
	const range = new Request("https://app.invalid/download", { headers: { Range: "bytes=1-2" } });
	expect(await (await fileResponse(range, async () => file)).text()).toBe("bc");
	vi.stubGlobal("fetch", vi.fn(async () => new Response("bc", { status: 206, headers: { "Content-Range": "bytes 0-1/9" } })));
	await expect(fileResponse(range, async () => file)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
});
