import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/server/auth", () => ({ owner: vi.fn(), guest: vi.fn(), authClient: vi.fn() }));
vi.mock("../../src/lib/server/db", async original => ({ ...await original<object>(), transaction: vi.fn(), rate: vi.fn() }));
vi.mock("../../src/lib/server/http", async original => ({ ...await original<object>(), csrf: vi.fn() }));
vi.mock("../../src/lib/server/service", async original => ({ ...await original<object>(), listProjects: vi.fn(), files: vi.fn(), archiveProject: vi.fn() }));
import { GET, POST } from "../../src/app/api/[...segments]/route";
import { owner } from "../../src/lib/server/auth";
import { transaction } from "../../src/lib/server/db";
import * as service from "../../src/lib/server/service";
const project = "00000000-0000-4000-8000-000000000001";
const actor = { kind: "owner" as const, id: project };
function request(path: string, method = "GET", value?: unknown) {
	const [route] = path.split("?");
	return (method === "GET" ? GET : POST)(new Request(`http://127.0.0.1:3000/api/${path}`, { method, headers: { "content-type": "application/json", "Idempotency-Key": project, "X-PM-Revision": '"2"' }, ...(value ? { body: JSON.stringify(value) } : {}) }), { params: Promise.resolve({ segments: (route ?? "").split("/") }) });
}
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(owner).mockResolvedValue(actor);
	vi.mocked(transaction).mockImplementation(async (_actor, work) => work({} as never));
	vi.mocked(service.listProjects).mockResolvedValue({ items: [], nextCursor: null, counts: { allCount: 0, folderCount: 0, searchMatchCount: 0 }, filters: { folderId: null, q: "", status: "active", sort: "created-desc" } });
	vi.mocked(service.files).mockResolvedValue({ items: [], nextCursor: null });
	vi.mocked(service.archiveProject).mockResolvedValue({ id: project, name: "P", description: "", revision: 3, createdAt: "now", archivedAt: "now" });
});
it("forwards combined project status, folder and search to the server query", async () => {
	expect((await request(`projects?status=archived&folderId=${project}&q=part`)).status).toBe(200);
	expect(service.listProjects).toHaveBeenCalledWith(actor, null, { status: "archived", folderId: project, q: "part" });
	expect((await request("projects?status=deleted")).status).toBe(422);
});
it("accepts scoped file cursors rather than requiring a UUID at the route layer", async () => {
	expect((await request(`projects/${project}/files?type=cad&sort=name-asc&cursor=scoped_cursor`)).status).toBe(200);
	expect(service.files).toHaveBeenCalledWith(actor, project, "scoped_cursor", "material", { type: "cad", sort: "name-asc" });
	for (const query of ["sort=sql", "type=private", "type=pdf&type=cad", "unknown=1"])
		expect((await request(`projects/${project}/files?${query}`)).status).toBe(422);
});
it("requires an explicit archive action, revision and idempotent write", async () => {
	expect((await request(`projects/${project}/archive`, "POST", { archived: true })).status).toBe(200);
	expect(service.archiveProject).toHaveBeenCalledWith(actor, project, true, 2, project);
	expect((await request(`projects/${project}/archive`, "POST", { archived: true, ownerId: project })).status).toBe(422);
});
