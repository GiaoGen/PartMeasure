import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ query: vi.fn(), remove: vi.fn(), info: vi.fn(), from: vi.fn() }));
vi.mock("../../src/lib/server/db", () => ({ transaction: (_actor: unknown, work: (db: unknown) => unknown, worker: boolean) => { if (!worker) throw Error("RESTRICTED_MAINTENANCE_REQUIRED"); return work({ query: m.query }); } }));
vi.mock("../../src/lib/server/storage", () => ({ privateBucket: "private", quarantine: "quarantine", storage: () => ({ from: m.from }) }));
import { cleanupUploads } from "../../src/lib/server/upload-cleanup";
const row = { id: "U", project_id: "P", owner_id: "A", quarantine_key: "P/U/source", state: "queued", reserved_bytes: "100" };
function fixture(state = "queued") {
	m.query.mockImplementation(async (sql: string) => {
		if (sql.startsWith("select r.id")) return { rows: [{ ...row, state }] };
		return { rows: [], rowCount: 1 };
	});
}
beforeEach(() => {
	vi.resetAllMocks(); fixture();
	m.from.mockReturnValue({ remove: m.remove, info: m.info });
	m.remove.mockResolvedValue({ error: null }); m.info.mockResolvedValue({ error: { statusCode: "404" }, data: null });
});
it("defaults to a bounded dry run without modifying objects or database state", async () => {
	expect(await cleanupUploads()).toMatchObject({ candidates: 1, cleaned: 0 });
	expect(m.remove).not.toHaveBeenCalled();
	expect(m.query).toHaveBeenCalledTimes(1);
});
it("verifies all deletions before releasing the reserved quota and fences settlement", async () => {
	expect(await cleanupUploads(true)).toMatchObject({ cleaned: 1, failed: 0 });
	expect(m.remove.mock.calls).toEqual([[["P/U/source"]], [["P/U/source", "P/U/canonical.webp", "P/U/thumb-320.webp", "P/U/thumb-640.webp"]]]);
	const release = m.query.mock.calls.findIndex(([sql]) => sql.startsWith("update pm.owner_usage"));
	expect(m.info.mock.invocationCallOrder.at(-1)).toBeLessThan(m.query.mock.invocationCallOrder[release] as number);
	expect(m.query.mock.calls.some(([sql]) => sql.includes("cleanup_token=$3 and cleanup_lease_until>now()"))).toBe(true);
});
it("keeps quota reserved on failed or unverified deletion", async () => {
	m.info.mockResolvedValue({ error: null, data: { name: "source" } });
	expect(await cleanupUploads(true)).toMatchObject({ failed: 1, cleaned: 0 });
	expect(m.query.mock.calls.some(([sql]) => sql.startsWith("update pm.owner_usage"))).toBe(false);
});
it("only removes the quarantine duplicate for ready assets, preserving private bytes and quota", async () => {
	fixture("ready");
	expect(await cleanupUploads(true)).toMatchObject({ cleaned: 1 });
	expect(m.from).toHaveBeenCalledWith("quarantine");
	expect(m.from).not.toHaveBeenCalledWith("private");
	expect(m.query.mock.calls.some(([sql]) => sql.startsWith("update pm.owner_usage"))).toBe(false);
});
it("refuses stored arbitrary object paths before issuing any destructive request", async () => {
	m.query.mockResolvedValue({ rows: [{ ...row, quarantine_key: "other/project/source" }] });
	expect(await cleanupUploads(true)).toMatchObject({ failed: 1 });
	expect(m.remove).not.toHaveBeenCalled();
});
