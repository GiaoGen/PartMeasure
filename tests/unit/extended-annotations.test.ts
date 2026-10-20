import { describe, expect, it } from "vitest";
import {
	emptyMetadata,
	validateAnnotation,
	moveGeometry,
	bounds,
	toScreen,
	fromScreen,
	type Geometry,
	type AnnotationDraft,
} from "../../src/lib/annotations";
import {
	arcGeometry,
	ellipseGeometry,
	angleGeometry,
	makeEllipse,
	editEllipse,
	validExtendedGeometry,
	geometryTarget,
} from "../../src/lib/geometry-extensions";
import {
	geometryPaths,
	dimensionPath,
	annotationText,
} from "../../src/lib/annotation-presentation";
import {
	requiredMeasurements,
	confirmedMetadata,
	validateMeasurementUnit,
} from "../../src/lib/annotation-collaboration";
import {
	threePointGeometry,
	dragHandleGeometry,
} from "../../src/lib/annotation-interaction";
const W = 1000,
	H = 800;
const angle: Geometry = {
	type: "angle",
	vertex: { x: 0.4, y: 0.5 },
	from: { x: 0.7, y: 0.5 },
	to: { x: 0.4, y: 0.2 },
	reflex: false,
};
const arc: Geometry = {
	type: "arc",
	from: { x: 0.3, y: 0.6 },
	via: { x: 0.5, y: 0.35 },
	to: { x: 0.7, y: 0.6 },
};
const ellipse: Geometry = {
	type: "ellipse",
	center: { x: 0.5, y: 0.5 },
	axisA: { x: 0.7, y: 0.5 },
	axisB: { x: 0.5, y: 0.625 },
};
const item = (geometry: Geometry): AnnotationDraft => ({
	id: "example",
	geometry,
	metadata: emptyMetadata(),
});
describe("extended manual geometry", () => {
	it("uses the second clicked point as angle vertex and leaves arc points in click order", () => {
		const a = { x: 0.25, y: 0.5 },
			b = { x: 0.5, y: 0.5 },
			c = { x: 0.5, y: 0.25 };
		expect(threePointGeometry("angle", [a, b, c])).toMatchObject({
			type: "angle",
			from: a,
			vertex: b,
			to: c,
		});
		expect(threePointGeometry("arc", [arc.from, arc.via, arc.to])).toEqual(arc);
		expect(
			arcGeometry(
				threePointGeometry("arc", [arc.from, arc.via, arc.to]) as typeof arc,
				W,
				H,
			)?.radius,
		).toBeCloseTo(200);
	});
	it("updates ellipse axis/rotation geometry from the original without mutating a saved target", () => {
		const before = JSON.stringify(ellipse),
			from = ellipseGeometry(ellipse, W, H);
		const wider = dragHandleGeometry(
			ellipse,
			"axisB",
			{ x: 0.5, y: 0.8 },
			W,
			H,
		);
		const rotated = dragHandleGeometry(
			ellipse,
			"rotate",
			{ x: 0.7, y: 0.3 },
			W,
			H,
		);
		if (wider.type !== "ellipse" || rotated.type !== "ellipse")
			throw Error("ellipse expected");
		expect(ellipseGeometry(wider, W, H).rx).toBeGreaterThan(from.rx);
		expect(ellipseGeometry(rotated, W, H).rotation).not.toBeCloseTo(
			from.rotation,
		);
		expect(validExtendedGeometry(wider, W, H)).toBe(true);
		expect(validExtendedGeometry(rotated, W, H)).toBe(true);
		expect(JSON.stringify(ellipse)).toBe(before);
	});
	it("updates angle controls without deriving a real measurement value", () => {
		const moved = dragHandleGeometry(
			angle,
			"vertex",
			{ x: 0.45, y: 0.55 },
			W,
			H,
		);
		const display = dragHandleGeometry(
			angle,
			"arcScale",
			{ x: 0.5, y: 0.4 },
			W,
			H,
		);
		expect(moved).toMatchObject({ vertex: { x: 0.45, y: 0.55 } });
		expect(geometryTarget(display)).toEqual(geometryTarget(angle));
		expect(validExtendedGeometry(moved, W, H)).toBe(true);
	});
	it("creates an ellipse along the complete dragged axis on non-square images", () => {
		for (const [from, to] of [
			[
				{ x: 0.3, y: 0.2 },
				{ x: 0.7, y: 0.8 },
			],
			[
				{ x: 0.7, y: 0.8 },
				{ x: 0.3, y: 0.2 },
			],
			[
				{ x: 0.2, y: 0.5 },
				{ x: 0.8, y: 0.5 },
			],
			[
				{ x: 0.5, y: 0.2 },
				{ x: 0.5, y: 0.8 },
			],
			[
				{ x: 0.01, y: 0.02 },
				{ x: 0.5, y: 0.5 },
			],
		] as const) {
			const g = makeEllipse(from, to, W, H),
				e = ellipseGeometry(g, W, H);
			expect(g.axisA).toEqual(to);
			expect(2 * g.center.x - g.axisA.x).toBeCloseTo(from.x);
			expect(2 * g.center.y - g.axisA.y).toBeCloseTo(from.y);
			expect(e.u.x * e.v.x + e.u.y * e.v.y).toBeCloseTo(0);
			expect(validExtendedGeometry(g, W, H)).toBe(true);
		}
	});
	it("lets the perpendicular axis grow longer without changing the original axis length", () => {
		const g = makeEllipse({ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }, W, H);
		const wider = editEllipse(g, "axisB", { x: 0.5, y: 0.75 }, W, H);
		expect(wider.type).toBe("ellipse");
		if (wider.type !== "ellipse") throw Error("ellipse required");
		const e = ellipseGeometry(wider, W, H);
		expect(e.rx).toBeCloseTo(200);
		expect(e.ry).toBeCloseTo(100);
		expect(validExtendedGeometry(wider, W, H)).toBe(true);
	});
	it("omits degenerate preview arcs before the pointer has moved", () => {
		expect(
			geometryPaths(
				{ ...ellipse, axisA: ellipse.center, axisB: ellipse.center },
				W,
				H,
			),
		).toEqual([]);
		expect(
			geometryPaths(
				{ type: "circle", center: { x: 0.5, y: 0.5 }, radiusX: 0, radiusY: 0 },
				W,
				H,
			),
		).toEqual([]);
		expect(
			geometryPaths(
				{ ...angle, from: angle.vertex, to: angle.vertex },
				W,
				H,
			).join(""),
		).not.toContain("A");
	});
	it("validates three new types without relaxing circle constraints", () => {
		for (const geometry of [angle, arc, ellipse])
			expect(() =>
				validateAnnotation(geometry, emptyMetadata(), W, H),
			).not.toThrow();
		expect(() =>
			validateAnnotation(
				{
					type: "circle",
					center: { x: 0.5, y: 0.5 },
					radiusX: 0.2,
					radiusY: 0.2,
				},
				emptyMetadata(),
				W,
				H,
			),
		).toThrow();
	});
	it("fits through all three arc points and preserves major versus minor sweep", () => {
		const a = arcGeometry(arc, W, H);
		expect(a).not.toBeNull();
		expect(a?.radius).toBeCloseTo(200);
		expect(Math.abs(a?.sweep ?? 0)).toBeCloseTo(Math.PI);
		for (const p of [arc.from, arc.via, arc.to])
			expect(
				Math.hypot(p.x * W - (a?.center.x ?? 0), p.y * H - (a?.center.y ?? 0)),
			).toBeCloseTo(200);
		const big = arcGeometry(
			{ ...arc, via: { x: 0.5, y: 0.85 }, to: { x: 0.5, y: 0.35 } },
			W,
			H,
		);
		expect(Math.abs(big?.sweep ?? 0)).toBeGreaterThan(Math.PI);
	});
	it("rejects degenerate, nearly collinear, and out-of-bounds arcs", () => {
		for (const bad of [
			{ ...arc, via: arc.from },
			{ ...arc, via: { x: 0.5, y: 0.60000001 } },
			{
				type: "arc" as const,
				from: { x: 0.1, y: 0.1 },
				via: { x: 0.9, y: 0.1 },
				to: { x: 0.9, y: 0.9 },
			},
		])
			expect(validExtendedGeometry(bad, W, H)).toBe(false);
	});
	it("stores positioning angles separately from human degrees, including reflex views", () => {
		expect(Math.abs(angleGeometry(angle, W, H).sweep)).toBeCloseTo(Math.PI / 2);
		expect(
			Math.abs(angleGeometry({ ...angle, reflex: true }, W, H).sweep),
		).toBeCloseTo(Math.PI * 1.5);
		expect(requiredMeasurements(item(angle))).toEqual(["angleValue"]);
		expect(item(angle).metadata.angleValue).toBeUndefined();
		expect(geometryTarget({ ...angle, arcScale: 0.2 })).toEqual(
			geometryTarget({ ...angle, arcScale: 0.8 }),
		);
	});
	it("preserves ellipse axes and physical orthogonality after rotations on non-square images", () => {
		const rotated = editEllipse(ellipse, "rotate", { x: 0.7, y: 0.3 }, W, H);
		expect(validExtendedGeometry(rotated, W, H)).toBe(true);
		const created = makeEllipse({ x: 0.3, y: 0.2 }, { x: 0.7, y: 0.8 }, W, H);
		expect(validExtendedGeometry(created, W, H)).toBe(true);
		expect(
			validExtendedGeometry({ ...ellipse, axisB: { x: 0.6, y: 0.6 } }, W, H),
		).toBe(false);
	});
	it("uses complete rotated ellipse/arc bounds when clamping moves", () => {
		for (const g of [arc, ellipse]) {
			const moved = moveGeometry(g, -100, 100, W, H),
				b = bounds(moved, W, H);
			expect(b.left).toBeCloseTo(0);
			expect(b.bottom).toBeCloseTo(1);
			expect(validExtendedGeometry(moved, W, H)).toBe(true);
		}
	});
	it("round-trips new points through viewport zoom and pan without changing semantics", () => {
		for (const view of [
			{ x: 100, y: -250, scale: 0.2 },
			{ x: -2000, y: 70, scale: 3.5 },
		])
			for (const p of [angle.vertex, arc.via, ellipse.axisA]) {
				const back = fromScreen(toScreen(p, W, H, view), W, H, view);
				expect(back.x).toBeCloseTo(p.x, 12);
				expect(back.y).toBeCloseTo(p.y, 12);
			}
	});
	it("draws endpoint caps/arrows with screen-fixed sizes for horizontal and diagonal lines", () => {
		const a = { x: 10, y: 10 },
			b = { x: 100, y: 80 };
		expect(dimensionPath(a, b, 1).match(/M/g)).toHaveLength(5);
		for (const scale of [0.2, 1, 4]) {
			const parts = dimensionPath(
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				scale,
			).split(" ");
			expect(parts.length).toBeGreaterThan(10);
			expect(geometryPaths(angle, W, H, scale)).toHaveLength(2);
		}
	});
	it("keeps typed quantities independent and rejects degree/length confusion", () => {
		expect(requiredMeasurements(item(ellipse))).toEqual(["dimension"]);
		expect(
			requiredMeasurements({
				...item(ellipse),
				metadata: { ...emptyMetadata(), ellipseMeasure: "majorRadius" },
			}),
		).toEqual(["majorRadius"]);
		expect(
			requiredMeasurements({
				...item(arc),
				metadata: {
					...emptyMetadata(),
					arcQuantities: ["radius", "arcLength", "angle"],
				},
			}),
		).toEqual(["dimension", "arcLength", "angleValue"]);
		for (const [f, u, v] of [
			["dimension", "deg", "45"],
			["angleValue", "mm", "45"],
			["angleValue", "deg", "360"],
		] as const)
			expect(() => validateMeasurementUnit(f, u, v)).toThrow();
		expect(() =>
			validateMeasurementUnit("angleValue", "deg", "45"),
		).not.toThrow();
		const result = confirmedMetadata(
			{
				...item(ellipse),
				metadata: {
					...emptyMetadata(),
					dimension: "40",
					ellipseMeasure: "majorRadius",
				},
			},
			"majorRadius",
			"2",
			"cm",
		);
		expect(result.dimension).toBe("4");
		expect(result.majorRadius).toBe("2");
		const degrees = confirmedMetadata(
			{ ...item(arc), metadata: { ...emptyMetadata(), dimension: "20" } },
			"angleValue",
			"180",
			"deg",
		);
		expect(degrees.unit).toBe("mm");
		expect(degrees.dimension).toBe("20");
	});
	it("never generates measured values from geometry and uses correct R/Ø/degree labels", () => {
		expect(
			annotationText({
				...item(arc),
				metadata: { ...emptyMetadata(), dimension: "20" },
			}),
		).toBe("R20 mm");
		expect(
			annotationText({
				...item(angle),
				metadata: { ...emptyMetadata(), angleValue: "45" },
			}),
		).toBe("45°");
		expect(
			annotationText({
				...item(ellipse),
				metadata: { ...emptyMetadata(), dimension: "10" },
			}),
		).toBe("Ø10 mm");
		expect(
			annotationText({
				...item(ellipse),
				metadata: {
					...emptyMetadata(),
					ellipseMeasure: "majorRadius",
					majorRadius: "5",
				},
			}),
		).toBe("a5 mm");
	});
});
