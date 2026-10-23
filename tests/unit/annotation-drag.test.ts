import { describe, expect, it } from "vitest";
import { annotationDragResult } from "../../src/lib/annotation-interaction";
import { emptyMetadata, moveGeometry, type AnnotationDraft, type Geometry } from "../../src/lib/annotations";

const geometries: Geometry[] = [
	{ type: "line", from: { x: 0.2, y: 0.3 }, to: { x: 0.6, y: 0.3 } },
	{ type: "circle", center: { x: 0.5, y: 0.5 }, radiusX: 0.1, radiusY: 0.125 },
	{ type: "angle", from: { x: 0.2, y: 0.4 }, vertex: { x: 0.4, y: 0.4 }, to: { x: 0.4, y: 0.2 }, reflex: false },
	{ type: "arc", from: { x: 0.3, y: 0.6 }, via: { x: 0.5, y: 0.35 }, to: { x: 0.7, y: 0.6 } },
	{ type: "ellipse", center: { x: 0.5, y: 0.5 }, axisA: { x: 0.7, y: 0.5 }, axisB: { x: 0.5, y: 0.625 } },
	{ type: "point", at: { x: 0.5, y: 0.5 } },
	{ type: "text", at: { x: 0.5, y: 0.5 }, text: "保持原备注" },
];
const draft = (geometry = geometries[0] as Geometry): AnnotationDraft => ({
	id: "selected",
	geometry,
	metadata: { ...emptyMetadata(), name: "原标注", dimension: "12.5" },
});

describe("annotation drag commits", () => {
	it.each(geometries)("moves $type without changing human dimensions or the original snapshot", geometry => {
		const start = draft(geometry);
		const snapshot = structuredClone(start);
		const moved = moveGeometry(geometry, 0.02, 0.01, 1000, 800);
		const result = annotationDragResult(start, start, moved);
		expect(result.conflict).toBe(false);
		expect(result.changed?.geometry).toEqual(moved);
		expect(result.changed?.metadata).toEqual(snapshot.metadata);
		expect(start).toEqual(snapshot);
	});
	it("does not commit zero movement, including an arrow nudge clamped at the image boundary", () => {
		const start = draft({ type: "point", at: { x: 0, y: 1 } });
		expect(annotationDragResult(start, start, moveGeometry(start.geometry, -1, 1))).toEqual({ changed: null, conflict: false });
	});
	it("rejects a drag when geometry, metadata or object identity changed, or the object was removed", () => {
		const start = draft();
		const moved = moveGeometry(start.geometry, 0.02, 0.01, 1000, 800);
		for (const current of [
			undefined,
			{ ...start, id: "other" },
			{ ...start, geometry: moveGeometry(start.geometry, -0.05, 0, 1000, 800) },
			{ ...start, metadata: { ...start.metadata, dimension: "50" } },
		]) expect(annotationDragResult(start, current, moved)).toEqual({ changed: null, conflict: true });
	});
	it("retains refreshed customer response data instead of restoring the drag-start summary", () => {
		const start = { ...draft(), collaboration: { pending: 1, submitted: 0 } };
		const current = { ...start, collaboration: { pending: 0, submitted: 1, values: { dimension: { value: "15", unit: "mm" as const } } } };
		const result = annotationDragResult(start, current, moveGeometry(start.geometry, 0.02, 0, 1000, 800));
		expect(result.changed?.collaboration).toEqual(current.collaboration);
		expect(result.changed?.metadata.dimension).toBe("12.5");
	});
});
