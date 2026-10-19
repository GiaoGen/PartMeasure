import { describe, it, expect } from "vitest";
import {
	acceptChanges,
	mergeProjectUpdates,
	type ProjectEvent,
} from "../../src/lib/project-events";
const event = (sequence: string): ProjectEvent => ({
	sequence,
	kind: "file.changed",
	entityId: "aa000000-0000-4000-8000-000000000000",
	fileId: null,
	revision: null,
	state: "ready",
});
const batch = (sequence: string, events: ProjectEvent[] = [], reset = false) => ({
	sequence,
	events,
	reset,
	cursor: "opaque_cursor",
});
describe("durable project update reduction", () => {
	it("coalesces bursts without duplicate entity reads and bounds catchup invalidation", () => {
		expect(mergeProjectUpdates([event("1")], [event("2")])).toEqual([event("2")]);
		expect(mergeProjectUpdates([event("1")], [{ kind: "resync" }])).toEqual([
			{ kind: "resync" },
		]);
		const many = Array.from({ length: 101 }, (_, i) => ({
			...event(String(i + 1)),
			entityId: `${i}`,
		}));
		expect(mergeProjectUpdates([], many)).toEqual([{ kind: "resync" }]);
	});
	it("accepts ordered data, dedupes replay and ignores an older response", () => {
		expect(
			acceptChanges("1", batch("3", [event("1"), event("2"), event("3")])).updates,
		).toHaveLength(2);
		expect(acceptChanges("3", batch("3", [event("2"), event("3")])).updates).toEqual([]);
		expect(acceptChanges("3", batch("2", [event("2")])).sequence).toBe("3");
	});
	it("requires an authoritative resync for initial load, retention or a gap", () => {
		expect(acceptChanges(null, batch("3")).updates).toEqual([{ kind: "resync" }]);
		expect(acceptChanges("1", batch("3", [], true)).updates).toEqual([{ kind: "resync" }]);
		expect(acceptChanges("1", batch("3", [event("3")])).updates).toEqual([{ kind: "resync" }]);
		expect(acceptChanges("1", batch("3", [event("2")])).updates).toEqual([{ kind: "resync" }]);
	});
	it("keeps bigint precision and rejects malformed or unbounded data", () => {
		expect(
			acceptChanges("9007199254740992", batch("9007199254740993", [event("9007199254740993")]))
				.updates,
		).toHaveLength(1);
		expect(() => acceptChanges("1", batch("9223372036854775808"))).toThrow();
		expect(() =>
			acceptChanges("1", batch("2", [{ ...event("2"), entityId: "secret" }])),
		).toThrow();
		expect(() => acceptChanges("1", batch("2", Array(101).fill(event("2"))))).toThrow();
	});
});
