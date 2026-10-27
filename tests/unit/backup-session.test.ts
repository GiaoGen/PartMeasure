import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import type pg from "pg";
import { guardSnapshotSession } from "../../scripts/maintenance/postgres-tools";
afterEach(() => vi.useRealTimers());
function client() { return Object.assign(new EventEmitter(), { query: vi.fn().mockResolvedValue({ rows: [] }) }); }
it("handles asynchronous connection errors and aborts the snapshot with a fixed code, without exposing the dependency", () => {
	const db = client(), guard = guardSnapshotSession(db as unknown as pg.Client, new AbortController().signal);
	try {
		expect(() => db.emit("error", Error("private connection/password/url"))).not.toThrow();
		expect(guard.signal.aborted).toBe(true); expect(guard.signal.reason.code).toBe("BACKUP_SNAPSHOT_LOST");
		expect(String(guard.signal.reason)).not.toContain("private");
	} finally { guard.stop(); }
});
it("keeps one bounded heartbeat pending, cancels on failure, and releases the timer/listener", async () => {
	vi.useFakeTimers(); const db = client();
	let reject: (error: Error) => void = () => {};
	db.query.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
	const guard = guardSnapshotSession(db as unknown as pg.Client, new AbortController().signal);
	try {
		await vi.advanceTimersByTimeAsync(60000); expect(db.query).toHaveBeenCalledTimes(1);
		reject(Error("lost")); await vi.advanceTimersByTimeAsync(1);
		expect(guard.signal.aborted).toBe(true);
		await vi.advanceTimersByTimeAsync(60000); expect(db.query).toHaveBeenCalledTimes(1);
	} finally { guard.stop(); }
	expect(db.listenerCount("error")).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
it("retains caller cancellation instead of reconnecting or resuming a lost snapshot", async () => {
	vi.useFakeTimers(); const db = client(), abort = new AbortController();
	const guard = guardSnapshotSession(db as unknown as pg.Client, abort.signal);
	try {
		abort.abort(); await vi.advanceTimersByTimeAsync(60000);
		expect(guard.signal.aborted).toBe(true); expect(db.query).not.toHaveBeenCalled();
	} finally { guard.stop(); }
});
