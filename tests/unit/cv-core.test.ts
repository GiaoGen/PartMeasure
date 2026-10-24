import { createRequire } from "node:module";
import type * as CV from "@techstark/opencv-js";
import { beforeAll, describe, expect, it } from "vitest";
import { analyze } from "../../src/lib/cv/core";
import { emptyMetadata, validateAnnotation, type Geometry } from "../../src/lib/annotations";

let cv: typeof CV;
beforeAll(async () => {
	cv = createRequire(import.meta.url)("@techstark/opencv-js");
	if (typeof cv.Mat !== "function") await new Promise<void>((resolve, reject) => {
		const runtime = cv as typeof CV & { onRuntimeInitialized: () => void; onAbort: () => void };
		const timer = setTimeout(() => reject(Error("CV_TEST_INITIALIZATION_TIMEOUT")), 5000);
		runtime.onRuntimeInitialized = () => { clearTimeout(timer); resolve(); };
		runtime.onAbort = () => { clearTimeout(timer); reject(Error("CV_TEST_INITIALIZATION_FAILED")); };
	});
});
describe("production CV core using the real pinned OpenCV runtime", () => {
	it("keeps all four intents on blank images without mutating inputs or returning candidates", () => {
		const drafts: Geometry[] = [
			{ type: "line", from: { x: .2, y: .3 }, to: { x: .8, y: .3 } },
			{ type: "angle", from: { x: .2, y: .5 }, vertex: { x: .5, y: .5 }, to: { x: .5, y: .2 }, reflex: false },
			{ type: "circle", center: { x: .5, y: .5 }, radiusX: .2, radiusY: .2 },
			{ type: "ellipse", center: { x: .5, y: .5 }, axisA: { x: .8, y: .5 }, axisB: { x: .5, y: .7 } },
		];
		const snapshot = structuredClone(drafts), result = analyze(cv, new Uint8Array(128 * 128 * 4).fill(255), 128, 128, drafts);
		expect(result.candidates).toEqual([]); expect(result.locals.map(r => r.output)).toEqual(snapshot); expect(drafts).toEqual(snapshot);
	});
	it.each(["circle", "ellipse"] as const)("detects a clear synthetic %s contour with valid normalized geometry", type => {
		const size = 256, pixels = new Uint8Array(size * size * 4), rx = 42, ry = type === "circle" ? 42 : 23;
		for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
			const a = (x - 128) * Math.cos(.4) + (y - 128) * Math.sin(.4), b = -(x - 128) * Math.sin(.4) + (y - 128) * Math.cos(.4);
			const white = a * a / (rx * rx) + b * b / (ry * ry) <= 1 ? 255 : 0;
			const at = (y * size + x) * 4; pixels[at] = pixels[at + 1] = pixels[at + 2] = white; pixels[at + 3] = 255;
		}
		const result = analyze(cv, pixels, size, size);
		expect(result.candidates.length).toBeGreaterThan(0); expect(result.candidates.length).toBeLessThanOrEqual(12);
		expect(result.candidates.some(c => c.geometry.type === type && Math.hypot(c.pixel.x - 128, c.pixel.y - 128) < 3)).toBe(true);
		for (const candidate of result.candidates) expect(() => validateAnnotation(candidate.geometry, emptyMetadata(), size, size)).not.toThrow();
	});
	it("rejects oversized images and pre-cancelled computation before producing geometry", () => {
		expect(() => analyze(cv, new Uint8Array(0), 1025, 1025)).toThrow("IMAGE_BUDGET");
		expect(() => analyze(cv, new Uint8Array(16 * 16 * 4), 16, 16, [], () => true)).toThrow("CANCELLED");
	});
});
