import { describe, it, expect } from "vitest";
import { model } from "../../experiments/konva/geometry";
import {
	type Geometry,
	createAnnotationSchema,
	geometrySchema,
	emptyMetadata,
	fitView,
	fromScreen,
	toScreen,
	zoomView,
	makeCircle,
	moveGeometry,
	validateAnnotation,
	sameContent,
} from "../../src/lib/annotations";
describe("standardized original image coordinates", () => {
	it("round trips existing spike points at portrait/landscape sizes and resizes, independent of DPR", () => {
		for (const [w, h] of [
			[640, 480],
			[480, 640],
			[4000, 3000],
			[8000, 5000],
		] as const)
			for (const width of [320, 780, 1440])
				for (const dpr of [1, 2, 3]) {
					const v = zoomView(
						fitView(w, h, width, 600),
						{ x: width * 0.37, y: 190 },
						0.73,
					);
					for (const point of [
						model.line.from,
						model.line.to,
						model.circle.center,
						model.point,
					]) {
						const screen = toScreen(point, w, h, v);
						const buffer = { x: screen.x * dpr, y: screen.y * dpr };
						const restored = fromScreen(
							{ x: buffer.x / dpr, y: buffer.y / dpr },
							w,
							h,
							v,
						);
						expect(
							Math.hypot(
								(point.x - restored.x) * w,
								(point.y - restored.y) * h,
							),
						).toBeLessThan(0.5);
					}
				}
	});
	it("keeps the pointer image position fixed while zooming", () => {
		const v = fitView(4000, 3000, 900, 700),
			p = { x: 310, y: 240 };
		expect(fromScreen(p, 4000, 3000, zoomView(v, p, v.scale * 3))).toEqual(
			fromScreen(p, 4000, 3000, v),
		);
	});
	it("preserves a true circle on non-square canonical images", () => {
		const g: Geometry = { type: "circle", ...model.circle };
		expect(() =>
			validateAnnotation(g, emptyMetadata(), 640, 480),
		).not.toThrow();
		expect(() =>
			validateAnnotation(
				{ ...g, radiusY: g.radiusX },
				emptyMetadata(),
				640,
				480,
			),
		).toThrow();
	});
	it("limits moved shapes and radius changes to image bounds without altering units", () => {
		const g = makeCircle({ x: 0.5, y: 0.5 }, { x: 0.95, y: 0.5 }, 4000, 3000);
		const moved = moveGeometry(g, 2, -2);
		expect(() =>
			validateAnnotation(moved, emptyMetadata(), 4000, 3000),
		).not.toThrow();
		expect(emptyMetadata().dimension).toBe("");
	});
});
describe("annotation data contract", () => {
	it("rejects non-finite/outside coordinates and unknown geometry fields", () => {
		for (const x of [NaN, Infinity, -0.01, 1.01])
			expect(
				geometrySchema.safeParse({ type: "point", at: { x, y: 0.3 } }).success,
			).toBe(false);
		expect(
			geometrySchema.safeParse({
				type: "point",
				at: { x: 0.1, y: 0.3 },
				ownerId: "forged",
			}).success,
		).toBe(false);
	});
	it("rejects zero line, zero circle, and a circle outside the image", () => {
		for (const geometry of [
			{ type: "line", from: { x: 0.3, y: 0.3 }, to: { x: 0.3, y: 0.3 } },
			{
				type: "circle",
				center: { x: 0.1, y: 0.1 },
				radiusX: 0.2,
				radiusY: 0.2,
			},
			{ type: "circle", center: { x: 0.5, y: 0.5 }, radiusX: 0, radiusY: 0 },
		] as Geometry[])
			expect(() =>
				validateAnnotation(geometry, emptyMetadata(), 640, 480),
			).toThrow();
	});
	it("allows empty manual dimensions but rejects pixel-to-mm or incompatible engineering fields", () => {
		const g: Geometry = { type: "line", ...model.line };
		expect(() =>
			validateAnnotation(g, emptyMetadata(), 640, 480),
		).not.toThrow();
		expect(() =>
			validateAnnotation(
				g,
				{ ...emptyMetadata(), dimension: "12.5" },
				640,
				480,
			),
		).not.toThrow();
		expect(() =>
			validateAnnotation(
				g,
				{ ...emptyMetadata(), source: "pixels" as "human" },
				640,
				480,
			),
		).toThrow();
		expect(() =>
			validateAnnotation(g, { ...emptyMetadata(), holeDepth: "3" }, 640, 480),
		).toThrow();
		expect(() =>
			validateAnnotation(
				{ type: "point", at: model.point },
				{ ...emptyMetadata(), dimension: "3" },
				640,
				480,
			),
		).toThrow();
	});
	it("limits text, engineering decimals and fields; rejects control fields", () => {
		const input = {
			id: "11111111-1111-4111-8111-111111111111",
			fileId: "22222222-2222-4222-8222-222222222222",
			imageHash: "a".repeat(64),
			geometry: { type: "point", at: model.point },
			metadata: emptyMetadata(),
		};
		expect(
			createAnnotationSchema.safeParse({ ...input, ownerId: "forged" }).success,
		).toBe(false);
		for (const dimension of ["1e3", "-1", "0", "Infinity"])
			expect(() =>
				validateAnnotation(
					{ type: "line", ...model.line },
					{ ...emptyMetadata(), dimension },
					640,
					480,
				),
			).toThrow();
		expect(
			geometrySchema.safeParse({
				type: "text",
				at: model.point,
				text: "x".repeat(501),
			}).success,
		).toBe(false);
	});
	it("compares persisted JSON independently of Postgres JSONB key order", () => {
		expect(
			sameContent(
				{
					geometry: { type: "point", at: model.point },
					metadata: emptyMetadata(),
				},
				{
					metadata: emptyMetadata(),
					geometry: {
						at: { y: model.point.y, x: model.point.x },
						type: "point",
					},
				},
			),
		).toBe(true);
	});
});
