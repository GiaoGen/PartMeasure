import { describe, expect, it, vi } from "vitest";
import { UploadPipeline } from "../../src/components/upload-pipeline";
import { DownloadBudget, rangeBytes } from "../../src/components/download-budget";

describe("bounded transfers overlap without multiplying processing or memory", () => {
	it("starts the next transfer while the first is processing and holds later reservations", async () => {
		const pipeline = new UploadPipeline(), signal = new AbortController().signal;
		let finish: () => void = () => {};
		const events: string[] = [];
		const first = pipeline.run("P", signal, async () => {
			events.push("transfer A");
			await pipeline.finish(signal, async () => { events.push("process A"); await new Promise<void>(resolve => { finish = resolve; }); });
		});
		const second = pipeline.run("P", signal, async () => { events.push("transfer B"); await pipeline.finish(signal, async () => { events.push("process B"); }); });
		const third = pipeline.run("P", signal, async () => { events.push("transfer C"); });
		await Promise.resolve();
		expect(events).toEqual(["transfer A", "process A", "transfer B"]);
		finish(); await Promise.all([first, second, third]);
		expect(events.indexOf("process B")).toBeGreaterThan(events.indexOf("transfer B"));
	});
	it("paces automatic upload reservations within the existing 10/minute ceiling", async () => {
		vi.useFakeTimers();
		try {
			const pipeline = new UploadPipeline(), signal = new AbortController().signal, start = vi.fn(async () => {});
			await Promise.all(Array.from({ length: 10 }, () => pipeline.reservation("P", signal, start)));
			const next = pipeline.reservation("P", signal, start);
			expect(start).toHaveBeenCalledTimes(10);
			await vi.advanceTimersByTimeAsync(61001); await next;
			expect(start).toHaveBeenCalledTimes(11);
		} finally { vi.useRealTimers(); }
	});
	it("keeps a global memory bound, releases cancelled waiters, and reuses assembly space", async () => {
		const budget = new DownloadBudget(100), signal = new AbortController();
		const held = await budget.acquire(80, signal.signal);
		const cancelled = new AbortController(), wait = budget.acquire(50, cancelled.signal);
		const rejection = expect(wait).rejects.toMatchObject({ name: "AbortError" }); cancelled.abort(); await rejection;
		const next = budget.acquire(50, signal.signal); held.shrink(40);
		const acquired = await next; acquired.release(); held.release();
		await expect(budget.acquire(100, signal.signal)).resolves.toBeDefined();
	});
	it("rejects overlong/truncated Range bodies while preserving valid progress", async () => {
		const signal = new AbortController().signal, progress = vi.fn();
		expect(await rangeBytes(new Response(new Uint8Array([1, 2])), 2, signal, progress)).toEqual(new Uint8Array([1, 2]));
		await expect(rangeBytes(new Response(new Uint8Array([1, 2, 3])), 2, signal, progress)).rejects.toThrow("RANGE_SIZE");
		await expect(rangeBytes(new Response(new Uint8Array([1])), 2, signal, progress)).rejects.toThrow("INCOMPLETE");
	});
});
