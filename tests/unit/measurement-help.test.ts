import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MeasurementHelp } from "../../src/components/measurement-help";
import { GuestAnnotationPanel } from "../../src/components/guest-annotation-panel";
import { emptyMetadata, type AnnotationDraft } from "../../src/lib/annotations";
import { caliperHelp, caliperMethods, caliperReadings } from "../../src/lib/measurement-help";

describe("optional contextual measurement help", () => {
	it.each(["outside", "inside", "depth"])("offers %s help collapsed without loading any illustration", method => {
		const html = renderToStaticMarkup(createElement(MeasurementHelp, { method }));
		expect(html).toContain('class="measurement-help"');
		expect(html).toContain(`aria-label="测量帮助：${caliperHelp(method)?.title}"`);
		expect(html).not.toMatch(/<details[^>]*\bopen(?:[\s=>])/);
		expect(html).not.toContain("<img");
		expect(html).not.toContain("/measurement-help/");
		expect(html).not.toContain("<form");
	});
	it("does not guess a tool when the method is unassigned, other or unknown", () => {
		for (const method of [undefined, null, "unspecified", "other", "future-tool", "__proto__"])
			expect(renderToStaticMarkup(createElement(MeasurementHelp, { method }))).toBe("");
	});
	it("does not teach length-caliper use for an angular measurement", () => {
		expect(renderToStaticMarkup(createElement(MeasurementHelp, { method: "outside", field: "angleValue" }))).toBe("");
	});
	const guestPanel = (item: AnnotationDraft) => renderToStaticMarkup(createElement(GuestAnnotationPanel, {
		item, base: "/api/guest/projects/p", fileId: "file", refreshKey: 0,
		onInvalid: () => {}, onUpdated: () => {}, onDirty: () => {},
	}));
	it("uses fallback help only when there is no active reply area to show it", () => {
		const item: AnnotationDraft = {
			id: "sample", geometry: { type: "line", from: { x: 0.2, y: 0.2 }, to: { x: 0.8, y: 0.2 } },
			metadata: { ...emptyMetadata(), measurementMethod: "outside" },
		};
		expect(guestPanel(item)).toContain('class="measurement-help"');
		expect(guestPanel({ ...item, collaboration: { pending: 1, submitted: 0 } })).not.toContain('class="measurement-help"');
	});
	it("hides fallback caliper help for an arc requiring only an angle or an explanatory annotation", () => {
		const item: AnnotationDraft = {
			id: "arc", geometry: { type: "arc", from: { x: 0.2, y: 0.4 }, via: { x: 0.5, y: 0.2 }, to: { x: 0.8, y: 0.4 } },
			metadata: { ...emptyMetadata(), measurementMethod: "outside", arcQuantities: ["angle"] },
		};
		expect(guestPanel(item)).not.toContain('class="measurement-help"');
		expect(guestPanel({ ...item, metadata: { ...item.metadata, measurementMode: "none" } })).not.toContain('class="measurement-help"');
	});
	it("ships all five illustrations locally, as standalone SVG with no embedded execution or remote images", async () => {
		for (const article of [...Object.values(caliperMethods), ...Object.values(caliperReadings)]) {
			const source = await readFile(new URL(`../../public${article.image}`, import.meta.url), "utf8");
			expect(source).toContain('viewBox="0 0 640 300"');
			expect(source).toContain("<title>");
			expect(source).not.toMatch(/<script|<foreignObject|\son\w+=|(?:href|src)=["']https?:/i);
		}
	});
	it("uses a consistent 0.05 mm vernier example rather than mixing the scale value and printed labels", async () => {
		const source = await readFile(new URL("../../public/measurement-help/vernier.svg", import.meta.url), "utf8");
		// Main scale starts at 10 mm at x=60, at 24px/mm. The vernier spans
		// 19 mm over 20 divisions. Division 7 must meet the 19 mm main tick.
		const zero = 60 + (12.35 - 10) * 24;
		const alignment = zero + 7 * (19 * 24 / 20);
		expect(alignment).toBeCloseTo(60 + (19 - 10) * 24);
		expect(source).toContain('x1="276" y1="97" x2="276" y2="181"');
		expect(source).toContain("12 + 7 × 0.05 = 12.35 mm");
		expect(caliperReadings.vernier.note).toContain("分度值");
		expect(caliperReadings.vernier.steps.join("")).toContain("0.02 mm");
	});
});
