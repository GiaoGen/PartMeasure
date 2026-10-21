import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EngineeringFields } from "../../src/components/engineering-fields";
import {
	emptyMetadata,
	type AnnotationDraft,
	type Geometry,
} from "../../src/lib/annotations";
import { photoStatusText } from "../../src/lib/annotation-presentation";

const from = { x: 0.2, y: 0.2 },
	to = { x: 0.8, y: 0.2 };
const render = (geometry: Geometry, metadata = {}) =>
	renderToStaticMarkup(
		createElement(EngineeringFields, {
			item: {
				id: "sample",
				geometry,
				metadata: { ...emptyMetadata(), ...metadata },
			},
			disabled: false,
			number: 2,
			onChange: () => {},
			onBlur: () => {},
		}),
	);
describe("aligned annotation properties", () => {
	it("keeps angle units separate from length units", () => {
		const html = render({
			type: "angle",
			from,
			to,
			vertex: { x: 0.5, y: 0.5 },
			reflex: false,
		});
		expect(html).toContain("人工角度");
		expect(html).toContain("取反角");
		expect(html).toContain("°");
		expect(html).not.toContain('aria-label="长度单位"');
	});
	it("groups all selected arc quantities with one shared length unit", () => {
		const html = render(
			{ type: "arc", from, to, via: { x: 0.5, y: 0.1 } },
			{ arcQuantities: ["radius", "arcLength", "angle"] },
		);
		for (const text of ["测量项目", "人工半径", "人工弧长", "人工圆心角"])
			expect(html).toContain(text);
		expect(html.match(/aria-label="长度单位"/g)).toHaveLength(1);
		const angleOnly = render(
			{ type: "arc", from, to, via: { x: 0.5, y: 0.1 } },
			{ arcQuantities: ["angle"] },
		);
		expect(angleOnly).not.toContain('aria-label="长度单位"');
	});
	it("defaults ellipse to diameter and supports the optional semiaxis", () => {
		const ellipse: Geometry = {
			type: "ellipse",
			center: { x: 0.5, y: 0.5 },
			axisA: { x: 0.7, y: 0.5 },
			axisB: { x: 0.5, y: 0.6 },
		};
		expect(render(ellipse)).toContain("人工孔径");
		expect(render(ellipse)).not.toContain("人工长半轴");
		expect(render(ellipse, { ellipseMeasure: "majorRadius" })).toContain(
			"人工长半轴 a",
		);
	});
	it("retains circle depth, hole type and thread inside optional properties", () => {
		const html = render({
			type: "circle",
			center: { x: 0.5, y: 0.5 },
			radiusX: 0.1,
			radiusY: 0.1,
		});
		for (const text of [
			"人工直径",
			"孔位属性",
			"需要补齐孔深",
			"孔类型",
			"螺纹规格",
		])
			expect(html).toContain(text);
	});
	it("leaves locator points and text free of numeric fields unless required", () => {
		const point: Geometry = { type: "point", at: from };
		expect(render(point)).not.toContain("人工尺寸");
		expect(render(point, { measurementMode: "required" })).toContain(
			"人工尺寸",
		);
		const text = render({ type: "text", at: from, text: "加工说明" });
		expect(text).toContain("标注文字");
		expect(text).not.toContain("人工尺寸");
		expect(text).not.toContain("测量方式");
	});
	it("adds only the explicit remeasure label to photos", () => {
		const item: AnnotationDraft = {
			id: "sample",
			geometry: { type: "line", from, to },
			metadata: emptyMetadata(),
		};
		expect(photoStatusText(item)).toBe("");
		expect(
			photoStatusText({ ...item, collaboration: { pending: 0, submitted: 1 } }),
		).toBe("");
		expect(
			photoStatusText({
				...item,
				collaboration: { pending: 0, submitted: 0, remeasure: 1 },
			}),
		).toBe("待补测");
	});
});
