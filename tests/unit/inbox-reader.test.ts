import { afterEach, describe, expect, it, vi } from "vitest";
import { InboxReader } from "../../src/components/inbox-reader";
import { packInbox, unpackInbox } from "../../src/lib/issue-inbox";
import type { IssueCurrent } from "../../src/lib/issues";
import { clearApiSession } from "../../src/components/api";

const readers: InboxReader[] = [];
const task = (id: string, revision = 1): IssueCurrent => ({
	id, revision, fileId: "F", fileLabel: "photo", view: "current", historyCount: 0,
	kind: "measurement", title: id, description: "", targetInfo: "", measurementMethod: "inside", measurementField: "diameter",
	state: "awaiting_response", latestResponseId: null, createdAt: "2026-10-22", updatedAt: "2026-10-22", responses: [], reviews: [],
	annotationRef: { id: "N", revision: 1 }, file: { id: "F", filename: "photo", mime: "image/webp", byteSize: "100" },
	target: { annotationRef: { id: "N", revision: 1 }, annotation: { id: "N", revision: 1, geometry: { type: "point", at: { x: .2, y: .3 } }, metadata: {} }, image: { id: "F", width: 100, height: 100, imageHash: "hash", normalizationVersion: "v1" } },
}) as unknown as IssueCurrent;
const packet = (items: IssueCurrent[], cursor: string | null = null, removed: string[] = []) => packInbox(items, { awaiting_response: items.length }, cursor, removed);
const setup = (transport: ConstructorParameters<typeof InboxReader>[2]) => {
	const reader = new InboxReader("/api/projects/P", vi.fn(), transport); readers.push(reader); return reader;
};
afterEach(() => { for (const reader of readers.splice(0)) reader.dispose(); clearApiSession(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("modal-owned complete current views", () => {
	it("deduplicates file/image/fixed snapshots without merging different annotation revisions", () => {
		const a = task("A"), b = task("B"), c = task("C");
		if (c.target) c.target = { ...c.target, annotationRef: { id: "N", revision: 2 } };
		const packed = packet([a, b, c]);
		expect(Object.keys(packed.files)).toHaveLength(1);
		expect(Object.keys(packed.images)).toHaveLength(1);
		expect(Object.keys(packed.targets)).toHaveLength(2);
		expect(unpackInbox(packed)).toEqual([a, b, c]);
		delete packed.targets["F:N:2"];
		expect(() => unpackInbox(packed)).toThrow("INBOX_BUNDLE_INCOMPLETE");
	});
	it("prepares sixty tasks in two serial pages, with no reads on subsequent selections", async () => {
		vi.useFakeTimers();
		let active = 0, peak = 0;
		const transport = vi.fn(async (cursor: string | null) => {
			peak = Math.max(peak, ++active); await Promise.resolve(); active--;
			return packet(Array.from({ length: 30 }, (_, n) => task(String(n + (cursor ? 30 : 0)))), cursor ? null : "next");
		});
		const reader = setup(transport); reader.open(); await vi.runAllTimersAsync();
		expect(reader.getSnapshot().views.size).toBe(60);
		for (let n = 0; n < 100; n++) reader.select([String(n % 60)]);
		vi.advanceTimersByTime(180000); await vi.runAllTimersAsync();
		expect(transport).toHaveBeenCalledTimes(2); expect(peak).toBe(1);
	});
	it("switching during preparation keeps the page alive and reuses the page result", async () => {
		vi.useFakeTimers();
		let finish: (value: ReturnType<typeof packet>) => void = () => {};
		const transport = vi.fn((_cursor, _ids, signal: AbortSignal) => new Promise<ReturnType<typeof packet>>(resolve => { expect(signal.aborted).toBe(false); finish = resolve; }));
		const reader = setup(transport); reader.open(); reader.select(["A"]); reader.select(["B"]);
		expect(transport.mock.calls[0]?.[2].aborted).toBe(false);
		finish(packet([task("A"), task("B")])); await vi.runAllTimersAsync();
		expect(transport).toHaveBeenCalledTimes(1); expect(reader.getSnapshot().views.has("B")).toBe(true);
	});
	it("finishes an unprepared selection before scheduling the next background page", async () => {
		vi.useFakeTimers();
		let finish: (value: ReturnType<typeof packet>) => void = () => {};
		const transport = vi.fn((cursor: string | null, ids: string[] | null) => ids
			? Promise.resolve(packet([task("B")]))
			: cursor ? Promise.resolve(packet([task("C")]))
			: new Promise<ReturnType<typeof packet>>(resolve => { finish = resolve; }));
		const reader = setup(transport); reader.open(); reader.select(["B"]);
		finish(packet([task("A")], "next")); await vi.runAllTimersAsync();
		expect(transport.mock.calls.map(call => call.slice(0, 2))).toEqual([[null, null], [null, ["B"]], ["next", null]]);
	});
	it("reopens a recently prepared modal without re-reading its complete working set", async () => {
		vi.useFakeTimers();
		const transport = vi.fn(async () => packet([task("A")]));
		const reader = setup(transport); reader.updates([{ kind: "resync" }]); reader.open(); await vi.runAllTimersAsync();
		reader.close(); reader.open(); reader.select(["A"]); await vi.runAllTimersAsync();
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it("coalesces changed IDs, ignores write echoes and never downgrades a local committed revision", async () => {
		vi.useFakeTimers();
		let finish: (value: ReturnType<typeof packet>) => void = () => {};
		const transport = vi.fn((_cursor, ids) => ids ? new Promise<ReturnType<typeof packet>>(resolve => { finish = resolve; }) : Promise.resolve(packet([task("A"), task("B")])));
		const reader = setup(transport); reader.open(); await vi.runAllTimersAsync();
		reader.updates([{ kind: "issue.changed", sequence: "2", entityId: "A", fileId: "F", revision: 2, state: "submitted" }, { kind: "issue.changed", sequence: "3", entityId: "A", fileId: "F", revision: 3, state: "submitted" }]);
		await vi.advanceTimersByTimeAsync(100);
		expect(transport.mock.calls[1]?.[1]).toEqual(["A"]);
		reader.accept(task("A", 4)); finish(packet([task("A", 3)])); await vi.runAllTimersAsync();
		expect(reader.getSnapshot().views.get("A")?.revision).toBe(4);
		reader.updates([{ kind: "issue.changed", sequence: "4", entityId: "A", fileId: "F", revision: 4, state: "submitted" }]);
		await vi.runAllTimersAsync(); expect(transport).toHaveBeenCalledTimes(2);
	});
	it("bounds automatic preparation to two hundred retained views and permits explicit continuation", async () => {
		vi.useFakeTimers();
		const transport = vi.fn(async (cursor: string | null, _ids, _signal, limit = 30) => {
			const page = Number(cursor ?? 0);
			return packet(Array.from({ length: limit }, (_, n) => task(`${page}-${n}`)), String(page + 1));
		});
		const reader = setup(transport); reader.open(); await vi.runAllTimersAsync();
		expect(transport).toHaveBeenCalledTimes(7); expect(reader.getSnapshot().views.size).toBe(200);
		reader.more(); await vi.runAllTimersAsync();
		expect(transport).toHaveBeenCalledTimes(8); expect(reader.getSnapshot().views.size).toBe(200);
	});
	it("clears identity state and fences a response that arrives after cancellation", async () => {
		vi.useFakeTimers();
		let finish: (value: ReturnType<typeof packet>) => void = () => {};
		const reader = setup(vi.fn(() => new Promise<ReturnType<typeof packet>>(resolve => { finish = resolve; })));
		reader.open(); reader.clear(true); finish(packet([task("private")])); await vi.runAllTimersAsync();
		expect(reader.getSnapshot().views.size).toBe(0); expect(reader.getSnapshot().items).toEqual([]);
		reader.open(); expect(reader.getSnapshot().loaded).toBe(false);
	});
	it("marks hidden/removed tasks unavailable instead of preserving a writable old form", async () => {
		vi.useFakeTimers();
		const reader = setup(vi.fn(async (_cursor, ids) => ids ? packet([], null, ["A"]) : packet([task("A")])));
		reader.open(); await vi.runAllTimersAsync(); reader.reload(["A"]); await vi.runAllTimersAsync();
		expect(reader.getSnapshot().views.has("A")).toBe(false);
		expect(reader.getSnapshot().unavailable.has("A")).toBe(true);
		expect(reader.getSnapshot().items).toEqual([]);
	});
});
