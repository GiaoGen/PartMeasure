import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EngineeringFields } from "../../src/components/engineering-fields";
import { bounds, emptyMetadata, geometrySchema, moveGeometry, validateAnnotation, type Geometry } from "../../src/lib/annotations";
import { annotationColor, geometryPaths, photoStatusText } from "../../src/lib/annotation-presentation";
import { dragHandleGeometry } from "../../src/lib/annotation-interaction";
import { calloutLayout, textTail, type TextGeometry } from "../../src/lib/text-callout";

const g = { type: "text", at: { x: 0.8, y: 0.7 }, labelAt: { x: 0.3, y: 0.2 }, text: "请确认这里的倒角" } satisfies TextGeometry;
describe("arrow text compatibility and geometry", () => {
	it("points from the saved tail to the saved end target in both directions", () => {
		for (const value of [g, { ...g, at: g.labelAt, labelAt: g.at }]) {
			const path = geometryPaths(value, 1000, 500, 1)[0];
			expect(path).toContain(`M${value.labelAt.x * 1000} ${value.labelAt.y * 500}L${value.at.x * 1000} ${value.at.y * 500}`);
			expect(path?.split(`L${value.at.x * 1000} ${value.at.y * 500}`)).toHaveLength(3);
		}
	});
	it("accepts legacy text, validates both coordinates, and rejects unknown or degenerate new geometry", () => {
		const legacy = { type: "text" as const, at: g.at, text: "原说明" };
		expect(() => validateAnnotation(legacy, emptyMetadata(), 1000, 500)).not.toThrow();
		expect(() => validateAnnotation(g, emptyMetadata(), 1000, 500)).not.toThrow();
		for (const labelAt of [{ x: -0.1, y: 0 }, { x: 0, y: Number.NaN }, null])
			expect(geometrySchema.safeParse({ ...g, labelAt }).success).toBe(false);
		expect(geometrySchema.safeParse({ ...g, color: "green" }).success).toBe(false);
		expect(() => validateAnnotation({ ...g, labelAt: g.at }, emptyMetadata(), 1000, 500)).toThrow();
	});
	it("moves both ends together, clamps to the image, and edits one handle independently", () => {
		const moved = moveGeometry(g, 2, 2, 1000, 500) as TextGeometry;
		expect(moved.at).toEqual({ x: 1, y: 1 });
		expect(moved).toHaveProperty("labelAt");
		expect(textTail(moved).x - g.labelAt.x).toBeCloseTo(moved.at.x - g.at.x);
		expect(bounds(moved).bottom).toBe(1);
		expect(dragHandleGeometry(g, "at", { x: 0.9, y: 0.5 }, 1000, 500)).toEqual({ ...g, at: { x: 0.9, y: 0.5 } });
		expect(dragHandleGeometry(g, "labelAt", { x: 0.2, y: 0.4 }, 1000, 500)).toEqual({ ...g, labelAt: { x: 0.2, y: 0.4 } });
		const legacy: TextGeometry = { type: "text", at: { x: 0.49, y: 0.3 }, text: "原说明" };
		const adjusted = moveGeometry(legacy, 0.1, 0, 1000, 500) as TextGeometry;
		expect(adjusted).toHaveProperty("labelAt");
		expect(textTail(adjusted).x).toBeCloseTo(textTail(legacy).x + 0.1);
	});
	it("keeps the callout red with no photo status label across collaboration states", () => {
		for (const collaboration of [undefined, { pending: 1, submitted: 0 }, { pending: 0, submitted: 1 }, { pending: 0, submitted: 0, remeasure: 1 }]) {
			const item = { id: "text", geometry: g, metadata: emptyMetadata(), ...(collaboration ? { collaboration } : {}) };
			expect(annotationColor(item)).toBe("#dc2626");
			expect(photoStatusText(item)).toBe("");
		}
	});
	it("wraps complete unicode text and keeps the block inside portrait and landscape images", () => {
		for (const [w, h] of [[400, 800], [800, 400], [64, 64]] as const) for (const scale of [0.2, 1, 4]) {
			const text = `中文🙂WW\n${"长文字".repeat(150)}`, layout = calloutLayout({ ...g, text }, w, h, scale);
			expect(layout.lines.join("")).toBe(text.replaceAll("\n", ""));
			expect(layout.x).toBeGreaterThanOrEqual(0); expect(layout.y).toBeGreaterThanOrEqual(0);
			expect(layout.x + layout.width).toBeLessThanOrEqual(w + 1e-6);
			expect(layout.y + layout.height).toBeLessThanOrEqual(h + 1e-6);
		}
	});
	it("shows only one editable text field while preserving legacy metadata read-only", () => {
		const item = { id: "legacy", geometry: g as Geometry, metadata: { ...emptyMetadata(), name: "旧名称", notes: "旧备注" } };
		const html = renderToStaticMarkup(createElement(EngineeringFields, { item, disabled: false, onChange: () => {}, onBlur: () => {} }));
		expect(html.match(/<textarea\b/g)).toHaveLength(1); expect(html).not.toContain("<input");
		expect(html).toContain("旧名称"); expect(html).toContain("旧备注");
		expect(item.metadata.name).toBe("旧名称");
	});
});
