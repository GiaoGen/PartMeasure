import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/server/db", () => ({ transaction: vi.fn(), idempotent: vi.fn(), rate: vi.fn() }));
vi.mock("../../src/lib/server/service", () => ({ access: vi.fn(), audit: vi.fn(), actorKey: (actor: { kind: string; id?: string; hash?: string }) => `${actor.kind}:${actor.id ?? actor.hash}` }));
import { addFeedback, listFeedback } from "../../src/lib/server/delivery-feedback-service";
import { transaction, idempotent } from "../../src/lib/server/db";
import { access } from "../../src/lib/server/service";
import { cursorScope, queryCursor, cursorId } from "../../src/lib/server/query-cursor";
import { AppError } from "../../src/lib/policy";

const project = "00000000-0000-4000-8000-000000000001";
const delivery = "00000000-0000-4000-8000-000000000002";
const session = "00000000-0000-4000-8000-000000000003";
const receipt = "00000000-0000-4000-8000-000000000004";
const guest = { kind: "guest" as const, hash: "guest" };
const query = vi.fn();
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(transaction).mockImplementation(async (_actor, work) => work({ query } as unknown as PoolClient));
	vi.mocked(idempotent).mockImplementation(async (_db, _scope, _key, _input, work) => work());
	vi.mocked(access).mockResolvedValue({ sessionId: session } as never);
	query.mockResolvedValue({ rows: [{ id: delivery }] });
});
describe("delivery feedback writes", () => {
	it("forbids Owner substitution and rejects unavailable deliveries before writes", async () => {
		await expect(addFeedback({ kind: "owner", id: project }, project, delivery, { kind: "received", body: "", guestLabel: "" }, "key")).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(transaction).not.toHaveBeenCalled();
		query.mockResolvedValueOnce({ rows: [] });
		await expect(addFeedback(guest, project, delivery, { kind: "received", body: "", guestLabel: "" }, "key")).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(idempotent).not.toHaveBeenCalled();
	});
	it("binds the actual session and delivery into an idempotent append", async () => {
		query.mockResolvedValueOnce({ rows: [{ id: delivery }] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ n: 0 }] }).mockResolvedValueOnce({ rows: [{ id: receipt, kind: "comment" }] });
		const input = { kind: "comment" as const, body: "需要补充说明", guestLabel: "客户" };
		await addFeedback(guest, project, delivery, input, "same-key");
		expect(idempotent).toHaveBeenCalledWith(expect.anything(), `${project}:guest:guest:delivery-feedback`, "same-key", { deliveryId: delivery, input }, expect.any(Function));
		expect(query.mock.calls[3]?.[1]).toEqual([project, delivery, session, "comment", input.body, "客户", null]);
	});
	it("rejects withdrawing another current record or downgrading an accepted receipt", async () => {
		for (const input of [{ kind: "withdrawn" as const, targetId: session }, { kind: "received" as const }, { kind: "accepted" as const }]) {
			query.mockResolvedValueOnce({ rows: [{ id: delivery }] }).mockResolvedValueOnce({ rows: [{ id: receipt, kind: "accepted" }] });
			await expect(addFeedback(guest, project, delivery, { ...input, body: "", guestLabel: "" }, "key")).rejects.toMatchObject({ code: "FEEDBACK_STATE_CONFLICT" });
		}
	});
	it("checks revocation before returning history", async () => {
		vi.mocked(access).mockRejectedValue(new AppError("LINK_UNAVAILABLE", 401));
		await expect(listFeedback(guest, project, delivery, null)).rejects.toMatchObject({ status: 401 });
		expect(query).not.toHaveBeenCalled();
	});
	it("caps pages, hides server identity fields and scopes cursors to the version and actor", async () => {
		const items = Array.from({ length: 21 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`, kind: "comment", body: "text" }));
		query.mockResolvedValueOnce({ rows: [{ id: delivery }] }).mockResolvedValueOnce({ rows: [{ items, total: 21, myReceipt: null, receipts: { received: 0, accepted: 0 }, anchorExists: true }] });
		const page = await listFeedback(guest, project, delivery, null);
		expect(page.items).toHaveLength(20);
		const scope = cursorScope(["delivery-feedback-v1", "guest:guest", project, delivery]);
		expect(page.nextCursor && cursorId(page.nextCursor, scope)).toBe(items[19]?.id);
		const cursor = queryCursor(receipt, scope);
		await expect(listFeedback(guest, project, session, cursor)).rejects.toMatchObject({ code: "CURSOR_INVALID" });
	});
});
