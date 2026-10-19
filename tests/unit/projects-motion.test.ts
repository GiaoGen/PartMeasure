import { describe, expect, it } from "vitest";
import { rippleGeometry } from "../../src/components/projects-theme";

describe("project background reveal bounds", () => {
	it.each([
		[320, 568],
		[390, 844],
		[1440, 900],
		[3840, 2160],
	])(
		"covers all viewport corners at %i × %i, including an offscreen folder origin",
		(width, height) => {
			for (const origin of [
				{ x: 120, y: 170 },
				{ x: 0, y: 0 },
				{ x: width, y: height },
				{ x: -100, y: height + 200 },
				{ x: width + 200, y: -100 },
			]) {
				const geometry = rippleGeometry(width, height, origin);
				const { radius } = geometry;
				const center = { x: geometry.x, y: geometry.y };
				expect(center.x).toBeGreaterThanOrEqual(0);
				expect(center.x).toBeLessThanOrEqual(width);
				expect(center.y).toBeGreaterThanOrEqual(0);
				expect(center.y).toBeLessThanOrEqual(height);
				for (const corner of [
					{ x: 0, y: 0 },
					{ x: width, y: 0 },
					{ x: 0, y: height },
					{ x: width, y: height },
				]) {
					expect(
						Math.hypot(corner.x - center.x, corner.y - center.y),
					).toBeLessThan(radius);
				}
			}
		},
	);
});
