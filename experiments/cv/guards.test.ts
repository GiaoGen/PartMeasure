import { before, test } from "node:test";
import assert from "node:assert/strict";
import type * as CV from "@techstark/opencv-js";
import type { Geometry } from "../../src/lib/annotations";
import { analyze, configuration, fitDetected, roundGeometry } from "./core";
import { loadCv } from "./runtime";

let cv: typeof CV;
before(async () => { ({ cv } = await loadCv()); });
test("rejects pixel and input-size overruns before entering CV", () => {
	assert.throws(() => analyze(cv, new Uint8Array(0), 1025, 1025), /IMAGE_BUDGET/);
	assert.throws(() => analyze(cv, new Uint8Array(3), 1, 1), /IMAGE_BUDGET/);
});
test("explicit cancellation returns no geometry", () => {
	assert.throws(() => analyze(cv, new Uint8Array(128 * 128 * 4), 128, 128, [], () => true), /CANCELLED/);
});
test("blank input retains line, angle, circle and ellipse intents unchanged", () => {
	const drafts: Geometry[] = [
		{ type: "line", from: { x: 0.2, y: 0.3 }, to: { x: 0.8, y: 0.3 } },
		{ type: "angle", from: { x: 0.2, y: 0.5 }, vertex: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.2 }, reflex: false },
		{ type: "circle", center: { x: 0.5, y: 0.5 }, radiusX: 0.2, radiusY: 0.2 },
		{ type: "ellipse", center: { x: 0.5, y: 0.5 }, axisA: { x: 0.8, y: 0.5 }, axisB: { x: 0.5, y: 0.7 } },
	];
	const before = structuredClone(drafts);
	const result = analyze(cv, new Uint8Array(128 * 128 * 4).fill(255), 128, 128, drafts);
	assert.equal(result.candidates.length, 0);
	assert.deepEqual(result.locals.map(item => item.output), before);
	assert(result.locals.every(item => !item.changed));
	assert.deepEqual(drafts, before);
});
test("draft budget remains bounded and arc stays manual-only", () => {
	const arc: Geometry = { type: "arc", from: { x: 0.2, y: 0.5 }, via: { x: 0.5, y: 0.2 }, to: { x: 0.8, y: 0.5 } };
	const pixels = new Uint8Array(128 * 128 * 4);
	assert.throws(() => analyze(cv, pixels, 128, 128, Array.from({ length: 33 }, () => arc)), /DRAFT_BUDGET/);
	const result = analyze(cv, pixels, 128, 128, [arc]);
	assert.equal(result.locals[0]?.reason, "manual-only-type");
	assert.deepEqual(result.locals[0]?.output, arc);
	assert(result.candidates.length <= configuration.maxCandidates);
});

test("invalid and non-finite intents are rejected before CV", () => {
	const pixels = new Uint8Array(128 * 128 * 4);
	const invalid: Geometry = { type: "line", from: { x: Number.NaN, y: 0.2 }, to: { x: 0.8, y: 0.2 } };
	assert.throws(() => analyze(cv, pixels, 128, 128, [invalid]), /INVALID_GEOMETRY/);
	const outOfBounds: Geometry = { type: "circle", center: { x: 0.95, y: 0.5 }, radiusX: 0.2, radiusY: 0.2 };
	assert.throws(() => analyze(cv, pixels, 128, 128, [outOfBounds]), /INVALID_GEOMETRY/);
});

test("local line preserves the chosen extent and leaves equally plausible edges unchanged", () => {
	const draft: Geometry = { type: "line", from: { x: 0.25, y: 0.32 }, to: { x: 0.75, y: 0.32 } };
	const edge = { from: { x: 20, y: 30 }, to: { x: 80, y: 30 } };
	const result = fitDetected({ lines: [edge], rounds: [] }, draft, 100, 100);
	assert.deepEqual(result.output, { type: "line", from: { x: 0.25, y: 0.3 }, to: { x: 0.75, y: 0.3 } });
	const ambiguous = fitDetected({ lines: [edge, { from: { x: 20, y: 34 }, to: { x: 80, y: 34 } }], rounds: [] }, draft, 100, 100);
	assert.deepEqual(ambiguous.output, draft);
	assert.equal(ambiguous.changed, false);
});

test("round coordinates preserve a physical pixel circle on non-square images", () => {
	const geometry = roundGeometry({ x: 100, y: 50, rx: 20, ry: 20, angle: 0 }, 200, 100);
	assert.equal(geometry.type, "circle");
	if (geometry.type === "circle") assert.equal(geometry.radiusX * 200, geometry.radiusY * 100);
});
