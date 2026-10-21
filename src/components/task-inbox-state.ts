import type { IssueState, IssueSummary } from "../lib/issues";
export function ownTask(item: Pick<IssueSummary, "state">, guest: boolean) {
	return guest
		? item.state === "awaiting_response" || item.state === "remeasure_requested"
		: false;
}
export function taskInboxState(
	counts: Partial<Record<IssueState, number>>,
	guest: boolean,
	unknown = false,
) {
	const replying =
		(counts.awaiting_response ?? 0) + (counts.remeasure_requested ?? 0);
	const own = guest ? replying : 0;
	const waiting = guest ? 0 : replying;
	return {
		own,
		waiting,
		tone: unknown ? "unknown" : own ? "action" : waiting ? "waiting" : "idle",
		label: unknown
			? "待办状态暂不可用"
			: own
				? `待我处理 ${own} 项`
				: waiting
					? `等待对方 ${waiting} 项`
					: "没有待处理事项",
	};
}
