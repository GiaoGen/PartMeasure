import { afterEach, describe, expect, it, vi } from "vitest";
import { api, clearApiSession, invalidateProjectQueries, readCached, seedApi } from "../../src/components/api";
import { collaborationUrl, currentIssueUrl, prioritizeLayers, readCollaboration, readCurrentIssue, readInteractionDocument, readLayers } from "../../src/components/interaction-reads";
import type { IssueCurrent } from "../../src/lib/issues";
import { applyIssueWrite } from "../../src/lib/issues";

const base = "/api/projects/P";
const current = (id: string, revision = 1): IssueCurrent => ({ id, revision, fileId: "F", view: "current", historyCount: 0, state: "awaiting_response", responses: [], reviews: [] }) as unknown as IssueCurrent;
afterEach(() => { clearApiSession(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("bounded aggregate reads share canonical resource keys", () => {
	it("batches seven visible layers into six plus one and reuses the editor key", async () => {
		vi.useFakeTimers();
		const fetch = vi.fn(async (url: string) => Response.json({ data: { items: new URL(url, "http://test").searchParams.get("ids")?.split(",").map(id => ({ image: { id }, items: [] })) } }));
		vi.stubGlobal("fetch", fetch);
		const pending = Promise.all(Array.from({ length: 7 }, (_, index) => readLayers(base, `F${index}`)));
		await vi.runAllTimersAsync();
		expect(await pending).toHaveLength(7);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(new URL(fetch.mock.calls[0]?.[0] ?? "", "http://test").searchParams.get("ids")?.split(",")).toHaveLength(6);
		await api(`${base}/files/F0/annotations`);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it("cancels one consumer without aborting another field in the shared batch", async () => {
		vi.useFakeTimers();
		let finish: (response: Response) => void = () => {};
		let transport: AbortSignal | undefined;
		vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => { transport = options.signal as AbortSignal; return new Promise<Response>(resolve => { finish = resolve; }); }));
		const cancel = new AbortController();
		const a = readCurrentIssue(base, "A", { signal: cancel.signal });
		const b = readCurrentIssue(base, "B");
		const cancelled = expect(a).rejects.toMatchObject({ name: "AbortError" });
		await vi.advanceTimersByTimeAsync(20);
		cancel.abort();
		await cancelled;
		expect(transport?.aborted).toBe(false);
		finish(Response.json({ data: { items: [current("A"), current("B")] } }));
		expect((await b).id).toBe("B");
		expect(readCached(currentIssueUrl(base, "A"))).toBeUndefined();
	});
	it("seeds selected annotation and all fields without list-to-detail round trips or truncated legacy history", async () => {
		const fetch = vi.fn(async () => Response.json({ data: { document: { image: { id: "F" }, items: [] }, issues: { items: [current("A"), current("B")], nextCursor: null } } }));
		vi.stubGlobal("fetch", fetch);
		seedApi(`${base}/issues/A`, { revision: 1, responses: ["full history"] });
		await readInteractionDocument(base, "F", "N");
		await readCollaboration(base, "F", "N", null);
		await Promise.all([readCurrentIssue(base, "A"), readCurrentIssue(base, "B"), api(`${base}/files/F/annotations`)]);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(readCached(`${base}/issues/A`)).toMatchObject({ responses: ["full history"] });
		expect(readCached(collaborationUrl(base, "F", "N"))).toBeDefined();
	});
	it("rejects cached aggregates consumed after an identity change, including their seeding side effects", async () => {
		seedApi(collaborationUrl(base, "F", "N"), { issues: { items: [current("A")], nextCursor: null } });
		const pending = readCollaboration(base, "F", "N", null);
		clearApiSession();
		await expect(pending).rejects.toMatchObject({ status: 401 });
		expect(readCached(currentIssueUrl(base, "A"))).toBeUndefined();
	});
	it("fences a batch whose revision was invalidated while in flight", async () => {
		vi.useFakeTimers();
		let finish: (response: Response) => void = () => {};
		const fetch = vi.fn(() => fetch.mock.calls.length === 1 ? new Promise<Response>(resolve => { finish = resolve; }) : Promise.resolve(Response.json({ data: { items: [current("A", 2)] } })));
		vi.stubGlobal("fetch", fetch);
		const pending = readCurrentIssue(base, "A");
		await vi.advanceTimersByTimeAsync(20);
		invalidateProjectQueries(base, [{ sequence: "2", kind: "issue.changed", entityId: "A", fileId: "F", revision: 2, state: "submitted" }]);
		finish(Response.json({ data: { items: [current("A", 1)] } }));
		await vi.runAllTimersAsync();
		expect((await pending).revision).toBe(2);
		expect(readCached(currentIssueUrl(base, "A"))).toMatchObject({ revision: 2 });
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it("promotes a clicked photo out of a queued gallery batch while keeping its shared document request", async () => {
		vi.useFakeTimers();
		const fetch = vi.fn(async (url: string) => Response.json({ data: { items: new URL(url, "http://test").searchParams.get("ids")?.split(",").map(id => ({ image: { id }, items: [] })) } }));
		vi.stubGlobal("fetch", fetch);
		const background = readLayers(base, "background");
		const selected = readLayers(base, "selected");
		prioritizeLayers(base, "selected");
		const editor = api(`${base}/files/selected/annotations`);
		await Promise.all([selected, editor]);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0]?.[0]).toContain("ids=selected");
		await vi.runAllTimersAsync();
		await background;
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it("updates the explicit current-view history count once per committed revision", () => {
		const response = { id: "R", issueRevision: 1, kind: "numeric" as const, value: "12", unit: "mm", body: "", authorType: "guest" as const, guestLabel: "", createdAt: "now", attachments: [] };
		const write = { issueId: "A", revision: 2, state: "submitted" as const, updatedAt: "now", response };
		const updated = applyIssueWrite(current("A"), write);
		expect(updated).toMatchObject({ view: "current", historyCount: 1, responses: [response] });
		expect(updated && applyIssueWrite(updated, write)?.historyCount).toBe(1);
	});
	it("reuses a prefetched task for click reads and keeps it alive when speculation is cancelled", async () => {
		vi.useFakeTimers();
		let finish: (response: Response) => void = () => {};
		const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
		vi.stubGlobal("fetch", fetch);
		const controller = new AbortController();
		const background = readCurrentIssue(base, "prefetched", { background: true, signal: controller.signal });
		const cancelled = expect(background).rejects.toMatchObject({ name: "AbortError" });
		await vi.advanceTimersByTimeAsync(20);
		const clicked = readCurrentIssue(base, "prefetched");
		controller.abort();
		await cancelled;
		finish(Response.json({ data: { items: [current("prefetched")] } }));
		expect((await clicked).id).toBe("prefetched");
		await readCurrentIssue(base, "prefetched");
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it("does not make a clicked task wait behind a different background batch", async () => {
		vi.useFakeTimers();
		let finish: (response: Response) => void = () => {};
		const fetch = vi.fn((url: string) => url.includes("ids=background")
			? new Promise<Response>(resolve => { finish = resolve; })
			: Promise.resolve(Response.json({ data: { items: [current("clicked")] } })));
		vi.stubGlobal("fetch", fetch);
		const background = readCurrentIssue(base, "background", { background: true });
		await vi.advanceTimersByTimeAsync(20);
		const clicked = readCurrentIssue(base, "clicked");
		expect((await clicked).id).toBe("clicked");
		expect(fetch).toHaveBeenCalledTimes(2);
		finish(Response.json({ data: { items: [current("background")] } }));
		await background;
		await vi.runAllTimersAsync();
	});
	it("keeps current views on unrelated uploads but invalidates their own evidence", async () => {
		vi.useFakeTimers();
		const issue = { ...current("A"), responses: [{ attachments: [{ id: "evidence" }] }] };
		vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { items: [issue] } })));
		const pending = readCurrentIssue(base, "A");
		await vi.runAllTimersAsync(); await pending;
		invalidateProjectQueries(base, [{ sequence: "2", kind: "file.changed", entityId: "other", fileId: "other", revision: null, state: "ready" }]);
		expect(readCached(currentIssueUrl(base, "A"))).toBeDefined();
		invalidateProjectQueries(base, [{ sequence: "3", kind: "file.changed", entityId: "evidence", fileId: "evidence", revision: null, state: "deleted" }]);
		expect(readCached(currentIssueUrl(base, "A"))).toBeUndefined();
	});
});
