import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	emptyMetadata,
	validateAnnotation,
	createAnnotationSchema,
	type AnnotationDraft,
} from "../../src/lib/annotations";
import {
	requiredMeasurements,
	measurementFieldLabel,
	annotationStatus,
} from "../../src/lib/annotation-collaboration";
import {
	queryPolicy,
	eventTags,
	mutationTags,
} from "../../src/components/cache-policy";
import { EngineeringFields } from "../../src/components/engineering-fields";
const line: AnnotationDraft = {
	id: "11111111-1111-4111-8111-111111111111",
	geometry: { type: "line", from: { x: 0.1, y: 0.1 }, to: { x: 0.6, y: 0.1 } },
	metadata: emptyMetadata(),
};
const base = "/api/guest/projects/p";
describe("annotation-first collaboration", () => {
	it("uses authoritative pending/review summaries instead of repeatedly asking submitted customers", () => {
		expect(
			annotationStatus({
				...line,
				collaboration: { pending: 0, submitted: 1 },
			}),
		).toBe("待确认");
		expect(
			annotationStatus({
				...line,
				collaboration: { pending: 0, submitted: 0 },
			}),
		).toBe("");
		expect(
			annotationStatus({
				...line,
				collaboration: { pending: 1, submitted: 1 },
			}),
		).toBe("待补充");
	});
	it("requires lengths and diameters by default, never text or locator points", () => {
		expect(requiredMeasurements(line)).toEqual(["dimension"]);
		expect(
			requiredMeasurements({
				...line,
				geometry: { type: "point", at: { x: 0.2, y: 0.2 } },
			}),
		).toEqual([]);
		expect(
			requiredMeasurements({
				...line,
				geometry: { type: "text", at: { x: 0.2, y: 0.2 }, text: "note" },
				metadata: { ...line.metadata, measurementMode: "required" },
			}),
		).toEqual([]);
		expect(
			requiredMeasurements({
				...line,
				metadata: { ...line.metadata, measurementMode: "none" },
			}),
		).toEqual([]);
	});
	it("makes diameter and requested depth independent, retaining radius semantics", () => {
		const hole: AnnotationDraft = {
			...line,
			geometry: {
				type: "circle",
				center: { x: 0.5, y: 0.5 },
				radiusX: 0.1,
				radiusY: 0.125,
			},
			metadata: {
				...line.metadata,
				requireHoleDepth: true,
				circleMeasure: "radius",
			},
		};
		expect(requiredMeasurements(hole)).toEqual(["dimension", "holeDepth"]);
		expect(measurementFieldLabel(hole, "dimension")).toBe("半径");
		expect(measurementFieldLabel(hole, "holeDepth")).toBe("孔深");
	});
	it("permits a human dimension on a point only when explicitly required", () => {
		const geometry = { type: "point" as const, at: { x: 0.2, y: 0.2 } };
		expect(() =>
			validateAnnotation(
				geometry,
				{ ...line.metadata, dimension: "10" },
				1000,
				800,
			),
		).toThrow();
		expect(() =>
			validateAnnotation(
				geometry,
				{ ...line.metadata, dimension: "10", measurementMode: "required" },
				1000,
				800,
			),
		).not.toThrow();
		expect(
			requiredMeasurements({
				...line,
				geometry,
				metadata: { ...line.metadata, measurementMode: "required" },
			}),
		).toEqual(["dimension"]);
	});
	it("accepts legacy metadata and validates new inputs without trusting control fields", () => {
		const input = {
			...line,
			fileId: "22222222-2222-4222-8222-222222222222",
			imageHash: "a".repeat(64),
		};
		expect(createAnnotationSchema.safeParse(input).success).toBe(true);
		for (const bad of [
			{ measurementMode: "publish" },
			{ measurementInstructions: "x".repeat(2001) },
			{ state: "confirmed" },
			{ measurementMethod: "AI" },
		])
			expect(
				createAnnotationSchema.safeParse({
					...input,
					metadata: { ...input.metadata, ...bad },
				}).success,
			).toBe(false);
	});
	it("invalidates the embedded list on events, saves, and confirmation writeback", () => {
		const tags = queryPolicy(`${base}/files/f/issues?annotationId=a`).tags;
		expect(
			eventTags(base, [
				{
					kind: "issue.changed",
					entityId: "i",
					fileId: "f",
					sequence: "1",
					revision: 1,
					state: "submitted",
				},
			]).some((t) => tags.includes(t)),
		).toBe(true);
		expect(mutationTags(`${base}/annotations/a`)).toContain(
			`${base}:issues:all`,
		);
		expect(mutationTags(`${base}/issues/i/review`)).toContain(
			`${base}:annotations:all`,
		);
		expect(mutationTags(`${base}/issues/i/responses`)).not.toContain(
			`${base}:annotations:all`,
		);
	});
	it("renders one property form with optional instructions and no publish action", () => {
		const html = renderToStaticMarkup(
			createElement(EngineeringFields, {
				item: line,
				disabled: false,
				onChange: () => {},
				onBlur: () => {},
			}),
		);
		expect(html).toContain("留空则自动提示客户补充");
		expect(html).toContain("测量说明（选填）");
		expect(html).toContain("仅说明，无需补充");
		expect(html).not.toContain("发送测量提醒");
	});
});
