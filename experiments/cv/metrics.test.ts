import assert from "node:assert/strict";
import { test } from "node:test";
import type { Geometry } from "../../src/lib/annotations";
import { contourError } from "./metrics";

test("parallel lines measure their pixel separation, symmetrically", () => {
	const a: Geometry = { type: "line", from: { x: .1, y: .3 }, to: { x: .8, y: .3 } };
	const b: Geometry = { type: "line", from: { x: .1, y: .4 }, to: { x: .8, y: .4 } };
	assert(Math.abs(contourError(a, b, 200, 100).meanPx - 10) < 1e-8);
	assert.deepEqual(contourError(a, b, 200, 100), contourError(b, a, 200, 100));
});

test("same rotated ellipse with opposite axis signs has zero contour error", () => {
	const a: Geometry = { type: "ellipse", center: { x: .5, y: .5 }, axisA: { x: .7, y: .65 }, axisB: { x: .455, y: .56 } };
	const b: Geometry = { ...a, axisA: { x: .3, y: .35 }, axisB: { x: .545, y: .44 } };
	assert(contourError(a, b, 100, 200).p95Px < 1e-8);
});

test("equal contour circles with different radii have the known radial error", () => {
	const a: Geometry = { type: "circle", center: { x: .5, y: .5 }, radiusX: .2, radiusY: .4 };
	const b: Geometry = { ...a, radiusX: .25, radiusY: .5 };
	assert(Math.abs(contourError(a, b, 200, 100).meanPx - 10) < .02);
});

test("angle metric reports vertex displacement even with long arms", () => {
	const a: Geometry = { type: "angle", from: { x: .1, y: .5 }, vertex: { x: .5, y: .5 }, to: { x: .5, y: .9 }, reflex: false };
	const b: Geometry = { ...a, vertex: { x: .55, y: .5 } };
	assert(Math.abs((contourError(a, b, 200, 100).vertexPx ?? 0) - 10) < 1e-8);
});
