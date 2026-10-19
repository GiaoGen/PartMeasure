import { describe, expect, it, vi } from "vitest";
import { emptyMetadata, type Annotation } from "../../src/lib/annotations";
import { prepareMeasurementReminder } from "../../src/components/measurement-reminder";

const annotationId = "11111111-1111-4111-8111-111111111111";
const draft = {
	fileId: "22222222-2222-4222-8222-222222222222",
	annotationId,
	title: "中心孔直径",
	targetInfo: "测量内径",
	description: "",
	measurementMethod: "inside" as const,
};
const head: Annotation = {
	id: annotationId,
	revision: 7,
	deleted: false,
	geometry: { type: "point", at: { x: 0.5, y: 0.5 } },
	metadata: emptyMetadata(),
	createdAt: "2026-10-18",
	updatedAt: "2026-10-18",
};

describe("测量提醒与已保存标注的绑定", () => {
	it("使用保存后返回的真实修订，而非绘制时的旧修订", async () => {
		const result = await prepareMeasurementReminder(draft, async () => head);
		expect(result.annotationRef).toEqual({ id: annotationId, revision: 7 });
		expect(result.targetInfo).toBe("测量内径");
	});
	it("无效输入不触发标注保存", async () => {
		const prepare = vi.fn(async () => head);
		await expect(
			prepareMeasurementReminder({ ...draft, targetInfo: " " }, prepare),
		).rejects.toThrow("测量要求");
		expect(prepare).not.toHaveBeenCalled();
	});
	it.each([
		undefined,
		{ ...head, deleted: true },
		{ ...head, id: "33333333-3333-4333-8333-333333333333" },
	])("保存未完成或返回不对应标注时，不生成发送内容", async (result) => {
		await expect(
			prepareMeasurementReminder(draft, async () => result),
		).rejects.toThrow("标注保存未完成");
	});
	it("保存失败会中止流程，不伪报发送成功", async () => {
		await expect(
			prepareMeasurementReminder(draft, async () => {
				throw new Error("网络中断");
			}),
		).rejects.toThrow("网络中断");
	});
});
