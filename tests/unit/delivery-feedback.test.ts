import { describe, expect, it } from "vitest";
import { feedbackInputSchema } from "../../src/lib/delivery-feedback";

describe("version feedback inputs", () => {
	it("requires a nonempty comment while permitting a receipt without a comment", () => {
		expect(feedbackInputSchema.safeParse({ kind: "comment", body: "  " }).success).toBe(false);
		expect(feedbackInputSchema.parse({ kind: "comment", body: " 补充说明 " }).body).toBe("补充说明");
		for (const kind of ["received", "accepted"]) expect(feedbackInputSchema.safeParse({ kind }).success).toBe(true);
	});
	it("requires an explicit withdrawal target and never trusts client identity or version state", () => {
		const id = "00000000-0000-4000-8000-000000000001";
		expect(feedbackInputSchema.safeParse({ kind: "withdrawn", targetId: id }).success).toBe(true);
		expect(feedbackInputSchema.safeParse({ kind: "withdrawn" }).success).toBe(false);
		expect(feedbackInputSchema.safeParse({ kind: "accepted", targetId: id }).success).toBe(false);
		for (const extra of [{ guestSessionId: id }, { authorType: "owner" }, { versionNo: 2 }, { deliveryId: id }, { receiptState: "current" }])
			expect(feedbackInputSchema.safeParse({ kind: "received", ...extra }).success).toBe(false);
	});
	it("bounds text and display labels", () => {
		expect(feedbackInputSchema.safeParse({ kind: "comment", body: "x".repeat(4001) }).success).toBe(false);
		expect(feedbackInputSchema.safeParse({ kind: "received", guestLabel: "x".repeat(81) }).success).toBe(false);
	});
});
