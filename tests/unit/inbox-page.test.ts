import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/server/db", async original => ({ ...await original<object>(), transaction: vi.fn() }));
vi.mock("../../src/lib/server/service", async original => ({ ...await original<object>(), access: vi.fn() }));
import { transaction } from "../../src/lib/server/db";
import { access } from "../../src/lib/server/service";
import { currentIssues, inboxPage } from "../../src/lib/server/interaction-reads";
import { unpackInbox } from "../../src/lib/issue-inbox";
import type { IssueCurrent } from "../../src/lib/issues";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { kind: "owner" as const, id: id(99) }, project = id(100);
const item = (n: number, description = ""): IssueCurrent => ({ id: id(n), revision: 1, view: "current", historyCount: 0, description, fileId: id(500), file: { id: id(500), filename: "photo", byteSize: "100", mime: "image/webp" }, target: null, responses: [], reviews: [], state: "awaiting_response" }) as unknown as IssueCurrent;
let items: IssueCurrent[];
const query = vi.fn();
beforeEach(() => {
	vi.clearAllMocks(); items = Array.from({ length: 31 }, (_, n) => item(n + 1));
	vi.mocked(transaction).mockImplementation(async (_actor, work) => work({ query } as never));
	vi.mocked(access).mockResolvedValue(undefined as never);
	query.mockImplementation(async (sql: string) => sql.includes("anchorExists") ? { rows: [{ items, anchorExists: true }] } : { rows: [{ state: "awaiting_response", n: items.length }] });
});
describe("inbox current-view pages", () => {
	it("shares one business authorization/transaction and returns thirty complete views plus a scoped cursor", async () => {
		const page = await inboxPage(actor, project, null);
		expect(page.items).toHaveLength(30); expect(page.nextCursor).toBeTruthy();
		expect(unpackInbox(page)[0]).toEqual(items[0]);
		expect(transaction).toHaveBeenCalledTimes(1); expect(access).toHaveBeenCalledTimes(1); expect(query).toHaveBeenCalledTimes(2);
		expect(query.mock.calls[0]?.[1]).toEqual([project, null, null, null, null, true, 31]);
		await expect(inboxPage(actor, id(101), page.nextCursor)).rejects.toMatchObject({ code: "CURSOR_INVALID" });
	});
	it("shrinks a large response at complete item boundaries and continues after its actual final item", async () => {
		items = items.map(row => ({ ...row, description: "x".repeat(50000) }));
		const page = await inboxPage(actor, project, null);
		expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1024 * 1024);
		expect(page.items.length).toBeGreaterThan(1); expect(page.items.length).toBeLessThan(30);
		expect(unpackInbox(page).every(row => row.description.length === 50000)).toBe(true);
		expect(JSON.parse(Buffer.from(page.nextCursor as string, "base64url").toString()).id).toBe(page.items.at(-1)?.id);
	});
	it("returns explicit removals for authorized update batches while preserving the old strict endpoint", async () => {
		items = [];
		const page = await inboxPage(actor, project, null, [id(1)]);
		expect(page.removedIds).toEqual([id(1)]); expect(page.nextCursor).toBeNull();
		await expect(currentIssues(actor, project, [id(1)])).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
	it("rejects invalid limits, duplicate IDs and authorization failures", async () => {
		await expect(inboxPage(actor, project, null, null, 31)).rejects.toMatchObject({ code: "INVALID_INPUT" });
		await expect(inboxPage(actor, project, null, [id(1), id(1)])).rejects.toMatchObject({ code: "INVALID_INPUT" });
		vi.mocked(access).mockRejectedValue({ code: "NOT_FOUND" });
		await expect(inboxPage(actor, project, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(query).not.toHaveBeenCalled();
	});
});
