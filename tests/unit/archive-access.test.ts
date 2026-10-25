import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { access } from "../../src/lib/server/service";
const owner = { kind: "owner" as const, id: "A" };
const guest = { kind: "guest" as const, hash: "G" };
const query = vi.fn();
const db = { query } as never;
const project = { id: "P", owner_id: "A", archived_at: "2026-10-25", revision: 2 };
beforeEach(() => query.mockReset());
it("allows archive reads but blocks both roles' business writes", async () => {
	query.mockResolvedValue({ rows: [project] });
	await expect(access(db, owner, "P", false, true)).resolves.toMatchObject({ project });
	await expect(access(db, owner, "P", true)).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });
	query.mockResolvedValueOnce({ rows: [project] }).mockResolvedValueOnce({ rows: [{ id: "S", share_id: "L" }] });
	await expect(access(db, guest, "P")).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });
	query.mockResolvedValueOnce({ rows: [project] }).mockResolvedValueOnce({ rows: [{ id: "S", share_id: "L" }] });
	await expect(access(db, guest, "P", false, true)).resolves.toMatchObject({ sessionId: "S" });
});
it("permits only an explicit Owner restore/revoke path and still validates sharing", async () => {
	query.mockResolvedValue({ rows: [project] });
	await expect(access(db, owner, "P", true, false, true)).resolves.toMatchObject({ project });
	await expect(access(db, { kind: "owner", id: "B" }, "P", true, false, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
	query.mockResolvedValueOnce({ rows: [project] }).mockResolvedValueOnce({ rows: [] });
	await expect(access(db, guest, "P", false, true)).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
});
