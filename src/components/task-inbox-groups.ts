import type { IssueSummary } from "../lib/issues";

export type TaskTone = "redo" | "missing" | "done";
export const taskToneLabel: Record<TaskTone, string> = {
	redo: "待补测",
	missing: "待补充",
	done: "已补充",
};
const rank: Record<TaskTone, number> = { redo: 0, missing: 1, done: 2 };
export function taskTone(item: IssueSummary): TaskTone {
	return item.state === "remeasure_requested"
		? "redo"
		: item.state === "awaiting_response"
			? "missing"
			: "done";
}
export type TaskCard = {
	id: string;
	label: string;
	tone: TaskTone;
	items: IssueSummary[];
};
export type TaskFileGroup = {
	fileId: string;
	label: string;
	cards: TaskCard[];
};

// A card represents one fixed annotation revision. Multiple required fields share
// it; different historical positions never silently share the same canvas.
export function groupTaskCards(items: IssueSummary[]): TaskFileGroup[] {
	const files = new Map<string, TaskFileGroup>();
	const cards = new Map<string, TaskCard>();
	const seen = new Set<string>();
	for (const item of items) {
		if (item.closedAt || seen.has(item.id)) continue;
		seen.add(item.id);
		let file = files.get(item.fileId);
		if (!file) {
			file = {
				fileId: item.fileId,
				label: item.fileLabel || "项目资料",
				cards: [],
			};
			files.set(item.fileId, file);
		}
		const ref = item.kind === "measurement" ? item.annotationRef : null;
		const key = ref
			? `${item.fileId}:${ref.id}:${ref.revision}`
			: `${item.fileId}:${item.id}`;
		const tone = taskTone(item);
		const existing = cards.get(key);
		if (existing) {
			existing.items.push(item);
			if (rank[tone] < rank[existing.tone]) existing.tone = tone;
		} else {
			const name = item.annotationLabel || item.title;
			const card = {
				id: key,
				label: `${item.annotationNumber ? `${item.annotationNumber} · ` : ""}${name}`,
				tone,
				items: [item],
			};
			cards.set(key, card);
			file.cards.push(card);
		}
	}
	for (const file of files.values()) {
		file.cards.sort((a, b) => rank[a.tone] - rank[b.tone]);
		for (const card of file.cards)
			card.items.sort((a, b) => rank[taskTone(a)] - rank[taskTone(b)]);
	}
	return [...files.values()];
}
