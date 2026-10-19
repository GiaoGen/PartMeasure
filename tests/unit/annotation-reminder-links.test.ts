import { describe, expect, it, vi } from "vitest";
import type { IssueDetail, IssueSummary } from "../../src/lib/issues";
import { emptyMetadata } from "../../src/lib/annotations";
import { resolveAnnotationReminders } from "../../src/components/annotation-reminder-links";

function summary(id: string): IssueSummary {
	return {
		id,
		fileId: "file",
		kind: "measurement",
		title: "同名孔位",
		description: "",
		targetInfo: "直径",
		measurementMethod: "inside",
		state: "awaiting_response",
		revision: 1,
		latestResponseId: null,
		createdAt: "2026-10-19",
		updatedAt: "2026-10-19",
	};
}
function detail(id: string, annotationId: string): IssueDetail {
	return {
		...summary(id),
		file: {
			id: "file",
			filename: "part.jpg",
			mime: "image/jpeg",
			byteSize: "123",
		},
		target: {
			annotationRef: { id: annotationId, revision: 3 },
			annotation: {
				id: annotationId,
				geometry: { type: "point", at: { x: 0.5, y: 0.5 } },
				metadata: emptyMetadata(),
			},
			image: {
				id: "file",
				width: 400,
				height: 400,
				imageHash: "a".repeat(64),
				normalizationVersion: 1,
			},
		},
		responses: [],
		reviews: [],
	};
}

describe("按真实标注关联查找测量提醒", () => {
	it("同名提醒仍按 annotationRef 匹配", async () => {
		const result = await resolveAnnotationReminders(
			[summary("a"), summary("b")],
			"file",
			"selected",
			async (id) => detail(id, id === "a" ? "other" : "selected"),
		);
		expect(result.map((item) => item.id)).toEqual(["b"]);
	});
	it("不读取其他文件和文件级说明", async () => {
		const read = vi.fn(async (id) => detail(id, "selected"));
		await resolveAnnotationReminders(
			[
				{ ...summary("a"), fileId: "other" },
				{ ...summary("b"), kind: "comment" },
			],
			"file",
			"selected",
			read,
		);
		expect(read).not.toHaveBeenCalled();
	});
	it("拒绝详情返回不相符的文件或提醒 ID", async () => {
		const result = await resolveAnnotationReminders(
			[summary("a"), summary("b")],
			"file",
			"selected",
			async (id) =>
				id === "a"
					? { ...detail(id, "selected"), fileId: "other" }
					: detail("other", "selected"),
		);
		expect(result).toEqual([]);
	});
	it("最多并发 4 个详情请求，并保持列表顺序", async () => {
		let active = 0,
			peak = 0;
		const result = await resolveAnnotationReminders(
			Array.from({ length: 12 }, (_, index) => summary(String(index))),
			"file",
			"selected",
			async (id) => {
				active++;
				peak = Math.max(peak, active);
				await Promise.resolve();
				active--;
				return detail(id, "selected");
			},
		);
		expect(peak).toBe(4);
		expect(result.map((item) => item.id)).toEqual(
			Array.from({ length: 12 }, (_, index) => String(index)),
		);
	});
	it("过期选择不会再开始详情读取", async () => {
		const read = vi.fn(async (id) => detail(id, "selected"));
		await resolveAnnotationReminders(
			[summary("a")],
			"file",
			"selected",
			read,
			() => false,
		);
		expect(read).not.toHaveBeenCalled();
	});
});
