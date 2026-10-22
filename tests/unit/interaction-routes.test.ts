import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/server/auth", () => ({ owner: vi.fn(), guest: vi.fn(), authClient: vi.fn() }));
vi.mock("../../src/lib/server/db", async importOriginal => ({ ...await importOriginal<object>(), transaction: vi.fn(), rate: vi.fn() }));
vi.mock("../../src/lib/server/interaction-reads", async importOriginal => ({ ...await importOriginal<object>(), layers: vi.fn(), currentIssues: vi.fn(), fileInteraction: vi.fn(), historyPage: vi.fn(), inboxPage: vi.fn() }));
vi.mock("../../src/lib/server/issue-service", async importOriginal => ({ ...await importOriginal<object>(), detailIssue: vi.fn() }));
vi.mock("../../src/lib/server/service", async importOriginal => ({ ...await importOriginal<object>(), imageAccess: vi.fn() }));

import { GET } from "../../src/app/api/[...segments]/route";
import { owner } from "../../src/lib/server/auth";
import { transaction, rate } from "../../src/lib/server/db";
import * as reads from "../../src/lib/server/interaction-reads";
import { detailIssue } from "../../src/lib/server/issue-service";
import { imageAccess } from "../../src/lib/server/service";

const project = "00000000-0000-4000-8000-000000000001";
const file = "00000000-0000-4000-8000-000000000002";
const annotation = "00000000-0000-4000-8000-000000000003";
const actor = { kind: "owner" as const, id: project };
async function get(path: string) {
	return GET(new Request(`http://127.0.0.1:3000/api/projects/${project}/${path}`), { params: Promise.resolve({ segments: ["projects", project, ...path.split("?")[0]?.split("/") ?? []] }) });
}
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(owner).mockResolvedValue(actor);
	vi.mocked(transaction).mockImplementation(async (_actor, work) => work({} as never));
	vi.mocked(rate).mockResolvedValue(undefined);
});
describe("aggregate routes preserve one auth/rate preflight and old detail contracts", () => {
	it("reads an entire inbox page with one preflight and rejects invalid update batches", async () => {
		vi.mocked(reads.inboxPage).mockResolvedValue({ items: [], files: {}, images: {}, targets: {}, counts: {}, nextCursor: null, removedIds: [] });
		expect((await get("inbox")).status).toBe(200);
		expect(owner).toHaveBeenCalledTimes(1); expect(rate).toHaveBeenCalledTimes(1);
		expect(reads.inboxPage).toHaveBeenCalledWith(actor, project, null, null, 30);
		expect((await get(`inbox?ids=${file}`)).status).toBe(200);
		expect(reads.inboxPage).toHaveBeenLastCalledWith(actor, project, null, [file], 30);
		expect((await get("inbox?limit=20")).status).toBe(200);
		expect(reads.inboxPage).toHaveBeenLastCalledWith(actor, project, null, null, 20);
		expect((await get("inbox?limit=31")).status).toBe(422);
		expect((await get(`inbox?ids=${file},${file}`)).status).toBe(422);
		expect((await get(`inbox?ids=${file}&cursor=x`)).status).toBe(422);
		expect((await get("inbox?unknown=1")).status).toBe(422);
	});
	it("uses one fresh preflight for an image manifest and caps it at thirty distinct files", async () => {
		vi.mocked(imageAccess).mockResolvedValue({ namespace: "a".repeat(64), items: [] });
		expect((await get(`image-access?ids=${file}`)).status).toBe(200);
		expect(owner).toHaveBeenCalledTimes(1);
		expect(rate).toHaveBeenCalledTimes(1);
		expect(imageAccess).toHaveBeenCalledWith(actor, project, [file]);
		expect((await get(`image-access?ids=${Array(31).fill(file).join(",")}`)).status).toBe(422);
	});
	it("routes a bounded gallery batch through normal authentication and failed-request accounting", async () => {
		vi.mocked(reads.layers).mockResolvedValue({ items: [] });
		expect((await get(`file-layers?ids=${file}`)).status).toBe(200);
		expect(owner).toHaveBeenCalledTimes(1);
		expect(rate).toHaveBeenCalledTimes(1);
		expect(reads.layers).toHaveBeenCalledWith(actor, project, [file]);
		vi.clearAllMocks();
		expect((await get(`file-layers?ids=${file},${file}`)).status).toBe(422);
		expect(rate).toHaveBeenCalledTimes(1);
		expect(reads.layers).not.toHaveBeenCalled();
	});
	it("reads a selected annotation aggregate and validates its query without bypassing preflight", async () => {
		vi.mocked(reads.fileInteraction).mockResolvedValue({ issues: { items: [], nextCursor: null } });
		expect((await get(`files/${file}/interaction?annotationId=${annotation}`)).status).toBe(200);
		expect(reads.fileInteraction).toHaveBeenCalledWith(actor, project, file, annotation, null, true);
		expect((await get(`files/${file}/interaction?annotationId=${annotation}&unknown=1`)).status).toBe(422);
	});
	it("keeps legacy history separate from the explicitly paginated contract", async () => {
		vi.mocked(detailIssue).mockResolvedValue({ responses: ["legacy-full"] } as never);
		vi.mocked(reads.historyPage).mockResolvedValue({ items: [], nextCursor: null });
		expect((await (await get(`issues/${annotation}/history`)).json()).data.responses).toEqual(["legacy-full"]);
		expect((await get(`issues/${annotation}/history-page`)).status).toBe(200);
		expect(reads.historyPage).toHaveBeenCalledWith(actor, project, annotation, null);
		expect(detailIssue).toHaveBeenCalledTimes(1);
	});
});
