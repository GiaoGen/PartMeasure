import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { emptyMetadata } from "../../src/lib/annotations";
import type { IssueDetail, IssueState } from "../../src/lib/issues";
import { historyEvents } from "../../src/components/issue-history";
vi.mock("../../src/components/issue-response-form", () => ({
	IssueResponseForm: () =>
		createElement("form", { "data-reply-input": true }, "客户填写入口"),
}));
vi.mock("../../src/components/issue-review-form", () => ({
	IssueReviewForm: () =>
		createElement("form", { "data-remeasure-action": true }, "要求补测"),
}));
import { MeasurementReplyContent } from "../../src/components/measurement-reply-content";

function fixture(state: IssueState = "remeasure_requested"): IssueDetail {
	return {
		id: "issue",
		fileId: "file",
		kind: "measurement",
		title: "圆弧半径",
		description: "",
		targetInfo: "通用位置说明",
		measurementMethod: "unspecified",
		measurementField: "dimension",
		state,
		revision: 3,
		latestResponseId: "response",
		createdAt: "2026-10-20T13:39:00Z",
		updatedAt: "2026-10-21T06:44:00Z",
		file: {
			id: "file",
			filename: "sample.webp",
			mime: "image/webp",
			byteSize: "200",
		},
		target: {
			annotationRef: { id: "arc", revision: 1 },
			annotation: {
				id: "arc",
				geometry: {
					type: "arc",
					from: { x: 0.2, y: 0.4 },
					via: { x: 0.5, y: 0.2 },
					to: { x: 0.8, y: 0.4 },
				},
				metadata: emptyMetadata(),
			},
			image: {
				id: "file",
				width: 1000,
				height: 800,
				imageHash: "hash",
				normalizationVersion: 1,
			},
		},
		responses: [
			{
				id: "response",
				issueRevision: 1,
				kind: "numeric",
				value: "45",
				unit: "mm",
				body: "",
				authorType: "guest",
				guestLabel: "工程师",
				createdAt: "2026-10-20T13:39:00Z",
				attachments: [],
			},
		],
		reviews: [
			{
				id: "review",
				responseId: "response",
				issueRevision: 2,
				decision: "remeasure",
				value: null,
				unit: null,
				source: null,
				note: "请重新测量并附位置照片",
				createdAt: "2026-10-21T06:44:00Z",
			},
		],
	};
}
const render = (issue: IssueDetail, guest = false) =>
	renderToStaticMarkup(
		createElement(MeasurementReplyContent, {
			issue,
			guest,
			base: "/api/projects/p",
			committedPending: false,
			formVersion: 0,
			onSaved: () => {},
			onInvalid: () => {},
			onDirty: () => {},
			onReload: () => {},
		}),
	);
describe("focused measurement replies", () => {
	it("prioritizes the remeasure reason and shows the old number only as a previous submission", () => {
		const html = render(fixture());
		expect(html.indexOf("请重新测量并附位置照片")).toBeLessThan(
			html.indexOf("上次提交"),
		);
		expect(html).toContain("上次提交：45 mm");
		expect(html).not.toContain('class="annotation-reply-value"');
		expect(html).toContain("等待客户重新提交");
		expect(html).not.toContain("测量位置与要求");
		expect(html).not.toContain("客户填写入口");
	});
	it("gives the customer a reply input instead of the engineer action", () => {
		const html = render(fixture(), true);
		expect(html).toContain("客户填写入口");
		expect(html).not.toContain("data-remeasure-action");
		expect(html).not.toContain("通用位置说明");
	});
	it("shows submitted results and allows only the engineer to request remeasurement", () => {
		const issue = fixture("submitted");
		expect(render(issue)).toContain('class="annotation-reply-value"');
		expect(render(issue)).toContain("data-remeasure-action");
		expect(render(issue, true)).not.toContain("data-remeasure-action");
		expect(render(issue, true)).not.toContain("客户填写入口");
	});
	it("does not invent numeric results for photo-only and unable replies", () => {
		for (const kind of ["photo", "unable"] as const) {
			const issue = fixture("submitted");
			issue.responses = issue.responses.map((r) => ({
				...r,
				kind,
				value: null,
				unit: null,
				body: kind === "unable" ? "没有工具" : "",
			}));
			const html = render(issue);
			expect(html).toContain(kind === "photo" ? "已补充测量照片" : "无法测量");
			expect(html).not.toContain("45");
		}
	});
	it("keeps history collapsed and derives role colors from actual authors instead of display names", () => {
		const issue = fixture();
		const html = render(issue);
		expect(html).toContain("历史记录");
		expect(html).not.toContain("reply-timeline");
		const events = historyEvents(issue);
		expect(events.map((e) => e.author)).toEqual(["guest", "owner"]);
		expect(events[0]?.label).toBe("工程师");
		expect(events[0]?.action).toBe("提交 45 mm");
	});
	it("preserves legacy manual corrections without presenting the old customer number as the result", () => {
		const issue = fixture("confirmed");
		issue.reviews = issue.reviews.map((r) => ({
			...r,
			decision: "confirm",
			value: "46.5",
			unit: "mm",
			source: "owner_manual",
			note: "人工修正",
		}));
		expect(render(issue)).toContain("46.5");
		expect(render(issue)).toContain("工程师历史录入");
		expect(issue.responses[0]?.value).toBe("45");
	});
});
