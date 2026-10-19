import { describe, expect, it } from "vitest";
import { annotationHitRegion } from "../../src/components/annotation-hit-region";

describe("资料图标注点击区域", () => {
	it("竖图按 contain 留白定位，不按卡片比例拉伸", () => {
		const hit = annotationHitRegion(
			{ type: "point", at: { x: 0, y: 0.5 } },
			{ width: 400, height: 800 },
			{ width: 400, height: 300 },
		);
		expect(hit.left).toBe(125);
		expect(hit.top).toBe(150);
		expect(hit.width).toBe(44);
		expect(hit.height).toBe(44);
	});
	it("横图上下留白后的线段位置和方向正确", () => {
		const hit = annotationHitRegion(
			{ type: "line", from: { x: 0.25, y: 0.5 }, to: { x: 0.75, y: 0.5 } },
			{ width: 800, height: 400 },
			{ width: 400, height: 300 },
		);
		expect(hit.left).toBe(200);
		expect(hit.top).toBe(150);
		expect(hit.width).toBe(200);
		expect(hit.transform).toContain("rotate(0deg)");
	});
	it("线段角度依真实图像尺寸计算", () => {
		const hit = annotationHitRegion(
			{ type: "line", from: { x: 0, y: 0 }, to: { x: 0.5, y: 1 } },
			{ width: 800, height: 400 },
			{ width: 400, height: 300 },
		);
		expect(hit.transform).toContain("rotate(45deg)");
	});
	it("小孔仍提供 44px 点击范围", () => {
		const hit = annotationHitRegion(
			{
				type: "circle",
				center: { x: 0.5, y: 0.5 },
				radiusX: 0.01,
				radiusY: 0.02,
			},
			{ width: 800, height: 400 },
			{ width: 320, height: 240 },
		);
		expect(hit.width).toBe(44);
		expect(hit.height).toBe(44);
	});
});
