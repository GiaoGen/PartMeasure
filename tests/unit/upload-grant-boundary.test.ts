import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ db: { query: vi.fn() }, access: vi.fn(), info: vi.fn(), sign: vi.fn() }));
vi.mock("../../src/lib/server/db", () => ({ transaction: (_a: unknown, work: (db: unknown) => unknown) => work(m.db) }));
vi.mock("../../src/lib/server/service", () => ({ access: m.access, actorKey: () => "guest:hash" }));
vi.mock("../../src/lib/server/storage", () => ({ quarantine: "quarantine", storage: () => ({ from: () => ({ info: m.info }) }), uploadGrant: m.sign }));
import { grantUpload } from "../../src/lib/server/upload-grant";
const actor = { kind: "guest" as const, hash: "hash" };
const row = { state: "reserved", actor_key: "guest:hash", quarantine_key: "P/U/source", expired: false };
const run = () => grantUpload(actor, "P", "U", new AbortController().signal);
beforeEach(() => {
	vi.resetAllMocks();
	m.db.query.mockResolvedValue({ rows: [row] });
	m.info.mockResolvedValue({ data: null, error: { statusCode: "404" } });
	m.sign.mockResolvedValue({ signedUrl: "private-upload", token: "ephemeral", path: row.quarantine_key });
});
it("issues a grant only to its original uploader and records its expiry after signing", async () => {
	expect(await run()).toMatchObject({ signedUrl: "private-upload" });
	expect(m.access).toHaveBeenCalledTimes(2);
	const update = m.db.query.mock.calls.findIndex(([sql]) => sql.startsWith("update"));
	expect(update).toBeGreaterThan(0);
	expect(m.sign.mock.invocationCallOrder[0]).toBeLessThan(m.db.query.mock.invocationCallOrder[update] as number);
});
it("withholds a late signed grant after revocation or archive", async () => {
	m.sign.mockImplementation(async () => { m.access.mockRejectedValue(Error("LINK_UNAVAILABLE")); return { token: "never-return" }; });
	await expect(run()).rejects.toThrow("LINK_UNAVAILABLE");
});
it("does not issue to a different uploader or an expired upload window", async () => {
	for (const changed of [{ actor_key: "guest:other" }, { expired: true }]) {
		m.db.query.mockResolvedValue({ rows: [{ ...row, ...changed }] });
		await expect(run()).rejects.toMatchObject({ status: changed.expired ? 409 : 404 });
	}
	expect(m.sign).not.toHaveBeenCalled();
});
it("checks writability even when an already uploaded object is found", async () => {
	m.info.mockImplementation(async () => { m.access.mockRejectedValue(Error("PROJECT_ARCHIVED")); return { data: {}, error: null }; });
	await expect(run()).rejects.toThrow("PROJECT_ARCHIVED");
	expect(m.sign).not.toHaveBeenCalled();
});
it("fails closed on Storage errors rather than treating them as missing objects", async () => {
	m.info.mockResolvedValue({ error: { statusCode: "503" }, data: null });
	await expect(run()).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
	expect(m.sign).not.toHaveBeenCalled();
});
