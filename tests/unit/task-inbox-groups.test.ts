import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { IssueSummary } from "../../src/lib/issues";
import { groupTaskCards } from "../../src/components/task-inbox-groups";
import { TaskCardRows } from "../../src/components/task-card-rows";

function task(id: string, overrides: Partial<IssueSummary> = {}): IssueSummary {
	return {
		id,
		fileId: "front",
		fileLabel: "正面.jpg",
		kind: "measurement",
		annotationRef: { id, revision: 1 },
		annotationLabel: "安装孔",
		annotationNumber: 2,
		title: "安装孔 · 孔深",
		description: "",
		targetInfo: "",
		measurementMethod: "unspecified",
		state: "awaiting_response",
		revision: 1,
		latestResponseId: null,
		createdAt: "2026-10-21T01:00:00Z",
		updatedAt: "2026-10-21T01:00:00Z",
		...overrides,
	};
}
describe("file-grouped task cards", () => {
	it("keeps file identity, orders remeasure/missing/done and never mutates input", () => {
		const input = [
			task("done", { state: "submitted" }),
			task("other", { fileId: "side", fileLabel: "侧面.jpg" }),
			task("missing"),
			task("redo", { state: "remeasure_requested" }),
		];
		const groups = groupTaskCards(input);
		expect(groups.map((g) => g.label)).toEqual(["正面.jpg", "侧面.jpg"]);
		expect(groups[0]?.cards.map((c) => c.tone)).toEqual([
			"redo",
			"missing",
			"done",
		]);
		expect(input.map((i) => i.id)).toEqual([
			"done",
			"other",
			"missing",
			"redo",
		]);
	});
	it("merges diameter/depth fields for the same fixed position; the highest priority wins", () => {
		const ref = { id: "hole", revision: 3 };
		const groups = groupTaskCards([
			task("diameter", { annotationRef: ref, state: "submitted" }),
			task("depth", {
				annotationRef: ref,
				state: "remeasure_requested",
				measurementField: "holeDepth",
			}),
		]);
		expect(groups[0]?.cards).toHaveLength(1);
		expect(groups[0]?.cards[0]).toMatchObject({
			tone: "redo",
			label: "2 · 安装孔",
		});
		expect(groups[0]?.cards[0]?.items.map((i) => i.id)).toEqual([
			"depth",
			"diameter",
		]);
	});
	it("does not merge a different file or fixed revision even when names match", () => {
		const items = [
			task("old", { annotationRef: { id: "hole", revision: 1 } }),
			task("new", { annotationRef: { id: "hole", revision: 2 } }),
			task("side", {
				fileId: "side",
				annotationRef: { id: "hole", revision: 1 },
			}),
		];
		expect(groupTaskCards(items).flatMap((g) => g.cards)).toHaveLength(3);
	});
	it("deduplicates paginated items and leaves closed records out of active cards", () => {
		const item = task("hole");
		expect(
			groupTaskCards([
				item,
				item,
				task("closed", { closedAt: "2026-10-21T02:00:00Z" }),
			])[0]?.cards,
		).toHaveLength(1);
	});
	it("keeps text questions independent and does not invent geometric numbering", () => {
		const groups = groupTaskCards([
			task("text", {
				kind: "comment",
				annotationRef: null,
				annotationLabel: null,
				annotationNumber: null,
				title: "表面处理方式",
				fileId: "pdf",
				fileLabel: "说明.pdf",
			}),
		]);
		expect(groups[0]?.cards[0]?.label).toBe("表面处理方式");
	});
	it("turns a card green only when all its current fields are complete", () => {
		const ref = { id: "hole", revision: 1 };
		const items = [
			task("diameter", { annotationRef: ref, state: "submitted" }),
			task("depth", { annotationRef: ref }),
		];
		expect(groupTaskCards(items)[0]?.cards[0]?.tone).toBe("missing");
		expect(
			groupTaskCards(items.map((i) => ({ ...i, state: "submitted" })))[0]
				?.cards[0]?.tone,
		).toBe("done");
	});
	it("renders only name/number on a card, with state available to assistive readers", () => {
		const groups = groupTaskCards([task("hole")]);
		const markup = renderToStaticMarkup(
			createElement(TaskCardRows, {
				groups,
				selected: groups[0]?.cards[0]?.id ?? null,
				onSelect: () => {},
			}),
		);
		expect(markup).toContain('aria-label="2 · 安装孔，待补充"');
		expect(markup).toContain('aria-pressed="true"');
		expect(markup).toContain(">2 · 安装孔</button>");
		expect(markup).not.toContain("安装孔 · 孔深");
		expect(markup).not.toContain(">待补充<");
	});
});
