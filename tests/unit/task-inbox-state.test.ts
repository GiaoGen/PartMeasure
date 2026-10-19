import { describe, expect, it } from "vitest";
import { ownTask, taskInboxState } from "../../src/components/task-inbox-state";

describe("task inbox role and status", () => {
	it("counts owner reviews and guest replies independently of loaded pages", () => {
		const counts = {
			awaiting_response: 31,
			remeasure_requested: 2,
			submitted: 5,
			confirmed: 100,
		};
		expect(taskInboxState(counts, false)).toMatchObject({
			own: 5,
			waiting: 33,
			tone: "action",
		});
		expect(taskInboxState(counts, true)).toMatchObject({
			own: 33,
			waiting: 5,
			tone: "action",
		});
	});
	it.each([false, true])(
		"treats confirmed-only counts as clear for guest=%s",
		(guest) => {
			expect(taskInboxState({ confirmed: 12 }, guest)).toMatchObject({
				own: 0,
				waiting: 0,
				tone: "idle",
				label: "没有待处理事项",
			});
		},
	);
	it("uses waiting color when the owner only awaits replies", () => {
		expect(
			taskInboxState({ awaiting_response: 2, remeasure_requested: 1 }, false),
		).toMatchObject({ own: 0, waiting: 3, tone: "waiting" });
	});
	it("uses waiting color when the guest only awaits review", () => {
		expect(taskInboxState({ submitted: 2 }, true)).toMatchObject({
			own: 0,
			waiting: 2,
			tone: "waiting",
		});
	});
	it("never calls failed or not-yet-loaded counts an all-clear", () => {
		expect(taskInboxState({}, false, true)).toMatchObject({
			tone: "unknown",
			label: "待办状态暂不可用",
		});
		expect(taskInboxState({ submitted: 2 }, false, true)).toMatchObject({
			own: 2,
			tone: "unknown",
		});
	});
	it.each(["awaiting_response", "remeasure_requested"] as const)(
		"gives %s to the guest",
		(state) => {
			expect(ownTask({ state }, true)).toBe(true);
			expect(ownTask({ state }, false)).toBe(false);
		},
	);
	it("gives submitted to the owner, and confirmed to neither role", () => {
		expect(ownTask({ state: "submitted" }, false)).toBe(true);
		expect(ownTask({ state: "submitted" }, true)).toBe(false);
		for (const guest of [false, true])
			expect(ownTask({ state: "confirmed" }, guest)).toBe(false);
	});
});
