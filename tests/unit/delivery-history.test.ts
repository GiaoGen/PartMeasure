import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";

vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/server/db", () => ({ transaction: vi.fn(), idempotent: vi.fn() }));
vi.mock("../../src/lib/server/service", () => ({
	access: vi.fn(), audit: vi.fn(),
	actorKey: (actor: { kind: string; id?: string; hash?: string }) => `${actor.kind}:${actor.id ?? actor.hash}`,
}));

import { transaction } from "../../src/lib/server/db";
import { access } from "../../src/lib/server/service";
import { getDelivery, listDeliveryHistory } from "../../src/lib/server/delivery-service";
import { cursorId, cursorScope, queryCursor } from "../../src/lib/server/query-cursor";
import { AppError } from "../../src/lib/policy";
import type { DeliverySummary } from "../../src/lib/deliveries";

const project = "00000000-0000-4000-8000-000000000001";
const actor = { kind: "owner" as const, id: project };
const query = vi.fn();
const scope = cursorScope(["delivery-history-v1", `owner:${project}`, project, 20]);
const items: DeliverySummary[] = Array.from({ length: 11 }, (_, index) => ({
	id: `00000000-0000-4000-8000-${String(index + 2).padStart(12, "0")}`,
	description: "版本说明", state: "published", revision: 2, versionNo: 19 - index,
	createdAt: "2026-10-25T00:00:00Z", publishedAt: "2026-10-25T01:00:00Z", fileCount: 2,
}));

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(transaction).mockImplementation(async (_actor, work) => work({ query } as unknown as PoolClient));
	query.mockResolvedValue({ rows: [{ items, anchorExists: true }] });
});

describe("delivery history authority and bounded pages", () => {
	it("caps a page at ten summaries and continues from the last returned version", async () => {
		const page = await listDeliveryHistory(actor, project, 20, null);
		expect(page.items).toHaveLength(10);
		expect(page.items[0]?.versionNo).toBe(19);
		expect(page.nextCursor && cursorId(page.nextCursor, scope)).toBe(items[9]?.id);
		expect(access).toHaveBeenCalledWith(expect.anything(), actor, project, false, true);
		expect(query.mock.calls[0]?.[1]).toEqual([project, 20, null, 11]);
		await listDeliveryHistory(actor, project, 20, page.nextCursor);
		expect(query.mock.calls[1]?.[1]).toEqual([project, 20, items[9]?.id, 11]);
	});
	it("ends an exact-size final page without a spurious next page", async () => {
		query.mockResolvedValue({ rows: [{ items: items.slice(0, 10), anchorExists: true }] });
		expect((await listDeliveryHistory(actor, project, 20, null)).nextCursor).toBeNull();
	});
	it("rejects cursors moved between projects, actors, or version boundaries", async () => {
		const cursor = queryCursor(items[0]?.id as string, scope);
		for (const work of [
			() => listDeliveryHistory(actor, items[0]?.id as string, 20, cursor),
			() => listDeliveryHistory({ kind: "guest", hash: "guest" }, project, 20, cursor),
			() => listDeliveryHistory(actor, project, 21, cursor),
			() => listDeliveryHistory(actor, project, 20, "broken"),
		]) await expect(work()).rejects.toMatchObject({ code: "CURSOR_INVALID", status: 422 });
		expect(transaction).not.toHaveBeenCalled();
	});
	it("rejects a well-formed cursor whose anchor is absent from the authorized published set", async () => {
		query.mockResolvedValue({ rows: [{ items: [], anchorExists: false }] });
		await expect(listDeliveryHistory(actor, project, 20, queryCursor(items[0]?.id as string, scope))).rejects.toMatchObject({ code: "CURSOR_INVALID" });
	});
	it("propagates revoked access before attempting to read version data", async () => {
		vi.mocked(access).mockRejectedValue(new AppError("LINK_UNAVAILABLE", 401));
		await expect(listDeliveryHistory({ kind: "guest", hash: "revoked" }, project, 20, null)).rejects.toMatchObject({ status: 401 });
		expect(query).not.toHaveBeenCalled();
	});
	it("does not return a draft to Guest even if a lower layer incorrectly returned it", async () => {
		query.mockResolvedValueOnce({ rows: [{ ...items[0], state: "draft" }] }).mockResolvedValueOnce({ rows: [] });
		await expect(getDelivery({ kind: "guest", hash: "guest" }, project, items[0]?.id as string)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
	});
	it("rejects invalid numeric boundaries before querying", async () => {
		for (const value of [0, -1, 1.5, NaN, Infinity, 2147483648])
			await expect(listDeliveryHistory(actor, project, value, null)).rejects.toMatchObject({ code: "INVALID_INPUT" });
		expect(transaction).not.toHaveBeenCalled();
	});
});
