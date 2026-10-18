import { describe, it, expect } from "vitest";
import { deliveryDraftSchema, versionLabel } from "../../src/lib/deliveries";
import { uploadInput } from "../../src/lib/policy";
const id = "11111111-1111-4111-8111-111111111111";
describe("P0-4 delivery boundary", () => {
	it("permits an empty private draft but rejects duplicate or excessive selected files", () => {
		expect(
			deliveryDraftSchema.safeParse({ description: "", fileIds: [] }).success,
		).toBe(true);
		expect(
			deliveryDraftSchema.safeParse({ description: "", fileIds: [id, id] })
				.success,
		).toBe(false);
		expect(
			deliveryDraftSchema.safeParse({
				description: "",
				fileIds: Array.from({ length: 21 }, () => id),
			}).success,
		).toBe(false);
	});
	it("does not accept client publication, ownership, revision or object paths", () => {
		for (const extra of [
			{ state: "published" },
			{ versionNo: 1 },
			{ publishedBy: id },
			{ revision: 2 },
			{ storageKey: "forged" },
		])
			expect(
				deliveryDraftSchema.safeParse({
					description: "",
					fileIds: [id],
					...extra,
				}).success,
			).toBe(false);
		expect(
			deliveryDraftSchema.safeParse({
				description: "a".repeat(4001),
				fileIds: [id],
			}).success,
		).toBe(false);
	});
	it("keeps legacy uploads compatible and bounds the explicit new purpose", () => {
		const input = {
			filename: "part.step",
			byteSize: 100,
			declaredMime: "application/octet-stream",
			sha256: "a".repeat(64),
		};
		expect(uploadInput.parse(input)).toEqual(input);
		expect(uploadInput.parse({ ...input, purpose: "delivery" }).purpose).toBe(
			"delivery",
		);
		expect(uploadInput.safeParse({ ...input, purpose: "public" }).success).toBe(
			false,
		);
	});
	it("shows unambiguous project version identifiers without clipping later versions", () => {
		expect(versionLabel(1)).toBe("V001");
		expect(versionLabel(1000)).toBe("V1000");
	});
});
