import { describe, it, expect } from "vitest";
import {
	states,
	nextState,
	responseSchema,
	reviewSchema,
	measurementSchema,
	validateResponse,
	validateReview,
} from "../../src/lib/issues";

describe("P0-3 workflow invariants", () => {
	it("allows exactly the approved transitions and no confirmed edits", () => {
		const permitted: Record<string, string> = {
			"awaiting_response:respond": "submitted",
			"remeasure_requested:respond": "submitted",
			"submitted:confirm": "confirmed",
			"submitted:remeasure": "remeasure_requested",
		};
		for (const state of states)
			for (const action of ["respond", "confirm", "remeasure"] as const) {
				const expected = permitted[`${state}:${action}`];
				if (expected) expect(nextState(state, action)).toBe(expected);
				else expect(() => nextState(state, action)).toThrow();
			}
	});
	it("requires human positive decimal values with length units and rejects control fields", () => {
		const valid = {
			kind: "numeric",
			value: "12.375",
			unit: "mm",
			body: "",
			evidenceFileIds: [],
			guestLabel: "",
		};
		expect(responseSchema.safeParse(valid).success).toBe(true);
		for (const value of [
			"0",
			"-1",
			"NaN",
			"Infinity",
			"1e3",
			".5",
			"1000000000",
			"1.1234567",
		])
			expect(responseSchema.safeParse({ ...valid, value }).success).toBe(false);
		for (const extra of [
			{ state: "confirmed" },
			{ ownerId: "forged" },
			{ source: "pixels" },
			{ unit: "rad" },
		])
			expect(responseSchema.safeParse({ ...valid, ...extra }).success).toBe(
				false,
			);
	});
	it("keeps photo/unable/text routes distinct without forcing numeric values", () => {
		const base = { body: "", evidenceFileIds: [], guestLabel: "" };
		expect(responseSchema.safeParse({ ...base, kind: "photo" }).success).toBe(
			false,
		);
		expect(
			responseSchema.safeParse({
				...base,
				kind: "photo",
				evidenceFileIds: ["11111111-1111-4111-8111-111111111111"],
			}).success,
		).toBe(true);
		expect(
			responseSchema.safeParse({ ...base, kind: "unable", body: "   " })
				.success,
		).toBe(false);
		expect(
			responseSchema.safeParse({
				...base,
				kind: "unable",
				body: "卡尺无法伸入",
			}).success,
		).toBe(true);
		const text = responseSchema.parse({
			...base,
			kind: "text",
			body: "零件清单在附件",
		});
		expect(() => validateResponse("comment", text)).not.toThrow();
		expect(() => validateResponse("measurement", text)).toThrow();
		const numeric = responseSchema.parse({
			...base,
			kind: "numeric",
			value: "3",
			unit: "mm",
		});
		expect(() => validateResponse("comment", numeric)).toThrow();
	});
	it("rejects duplicate/oversized attachment sets and missing fixed annotation revision", () => {
		const id = "11111111-1111-4111-8111-111111111111",
			base = { kind: "photo", body: "", guestLabel: "" };
		expect(
			responseSchema.safeParse({ ...base, evidenceFileIds: [id, id] }).success,
		).toBe(false);
		expect(
			responseSchema.safeParse({
				...base,
				evidenceFileIds: Array.from({ length: 11 }, () => id),
			}).success,
		).toBe(false);
		const measurement = {
			kind: "measurement",
			fileId: id,
			annotationRef: { id, revision: 1 },
			title: "孔径",
			targetInfo: "所标孔内径",
			description: "",
			measurementMethod: "inside",
		};
		expect(measurementSchema.safeParse(measurement).success).toBe(true);
		expect(
			measurementSchema.safeParse({ ...measurement, annotationRef: { id } })
				.success,
		).toBe(false);
		expect(
			measurementSchema.safeParse({ ...measurement, targetInfo: "" }).success,
		).toBe(false);
	});
	it("never treats a changed number as the original customer value", () => {
		const response = { kind: "numeric" as const, value: "12.5", unit: "mm" },
			base = reviewSchema.parse({
				decision: "confirm",
				responseId: "11111111-1111-4111-8111-111111111111",
				value: "12.5",
				unit: "mm",
				source: "customer_numeric",
				note: "",
			});
		expect(() => validateReview("measurement", response, base)).not.toThrow();
		expect(() =>
			validateReview("measurement", response, { ...base, value: "12.6" }),
		).toThrow();
		expect(() =>
			validateReview("measurement", response, { ...base, unit: "cm" }),
		).toThrow();
		expect(() =>
			validateReview("measurement", response, {
				...base,
				source: "owner_manual",
				value: "12.6",
				note: "依另一视角人工核对并修正",
			}),
		).not.toThrow();
	});
	it("requires notes for manual/photo confirmation and remeasurement, no fake number for comments", () => {
		const base = reviewSchema.parse({
				decision: "confirm",
				responseId: "11111111-1111-4111-8111-111111111111",
				value: "8",
				unit: "mm",
				source: "owner_from_photo",
				note: "照片刻度人工核对",
			}),
			photo = { kind: "photo" as const, value: null, unit: null };
		expect(() => validateReview("measurement", photo, base)).not.toThrow();
		expect(() =>
			validateReview("measurement", photo, { ...base, note: "" }),
		).toThrow();
		expect(() =>
			validateReview("measurement", photo, {
				...base,
				source: "customer_numeric",
			}),
		).toThrow();
		expect(() =>
			validateReview("measurement", photo, {
				...base,
				decision: "remeasure",
				source: null,
				value: null,
				unit: null,
				note: "",
			}),
		).toThrow();
		expect(() =>
			validateReview(
				"comment",
				{ kind: "text", value: null, unit: null },
				{ ...base, source: "comment", value: null, unit: null, note: "" },
			),
		).not.toThrow();
		expect(() =>
			validateReview(
				"comment",
				{ kind: "text", value: null, unit: null },
				base,
			),
		).toThrow();
	});
});
