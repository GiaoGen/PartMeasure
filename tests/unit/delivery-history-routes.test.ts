import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/server/auth", () => ({ owner: vi.fn(), guest: vi.fn(), authClient: vi.fn() }));
vi.mock("../../src/lib/server/db", async original => ({ ...await original<object>(), transaction: vi.fn(), rate: vi.fn() }));
vi.mock("../../src/lib/server/delivery-service", () => ({ listDeliveries: vi.fn(), listDeliveryHistory: vi.fn(), getDelivery: vi.fn() }));

import { GET } from "../../src/app/api/[...segments]/route";
import { owner, guest } from "../../src/lib/server/auth";
import { transaction, rate } from "../../src/lib/server/db";
import * as deliveries from "../../src/lib/server/delivery-service";

const project = "00000000-0000-4000-8000-000000000001";
const actor = { kind: "owner" as const, id: project };
async function get(query = "", asGuest = false) {
	const segments = [...(asGuest ? ["guest"] : []), "projects", project, "deliveries"];
	return GET(new Request(`http://127.0.0.1:3000/api/${segments.join("/")}${query}`), { params: Promise.resolve({ segments }) });
}
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(owner).mockResolvedValue(actor);
	vi.mocked(guest).mockResolvedValue({ kind: "guest", hash: "guest" });
	vi.mocked(transaction).mockImplementation(async (_actor, work) => work({ query: async () => ({ rows: [{ id: project }] }) } as never));
	vi.mocked(rate).mockResolvedValue(undefined);
	vi.mocked(deliveries.listDeliveries).mockResolvedValue({ published: null, drafts: [] });
	vi.mocked(deliveries.listDeliveryHistory).mockResolvedValue({ items: [], nextCursor: null });
});
describe("delivery history route", () => {
	it("preserves the current delivery/draft response and adds an explicit paginated view", async () => {
		expect((await (await get()).json()).data).toEqual({ published: null, drafts: [] });
		const response = await get("?view=history&beforeVersion=3");
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toContain("no-store");
		expect(deliveries.listDeliveryHistory).toHaveBeenCalledWith(actor, project, 3, null);
	});
	it("uses the authenticated Guest actor and the existing preflight", async () => {
		expect((await get("?view=history&beforeVersion=3&cursor=example", true)).status).toBe(200);
		expect(guest).toHaveBeenCalledWith(project);
		expect(owner).not.toHaveBeenCalled();
		expect(rate).toHaveBeenCalledTimes(2);
		expect(deliveries.listDeliveryHistory).toHaveBeenCalledWith({ kind: "guest", hash: "guest" }, project, 3, "example");
	});
	it("rejects incomplete, ambiguous, unbounded and unrelated query parameters", async () => {
		for (const query of [
			"?view=history", "?view=all&beforeVersion=3", "?view=history&beforeVersion=0", "?view=history&beforeVersion=1.5",
			"?view=history&beforeVersion=2147483648", "?view=history&beforeVersion=3&limit=999",
			"?view=history&beforeVersion=3&beforeVersion=4", "?view=history&view=history&beforeVersion=3",
			"?view=history&beforeVersion=3&cursor=", "?beforeVersion=3", "?cursor=example",
		]) expect((await get(query)).status).toBe(422);
		expect(deliveries.listDeliveryHistory).not.toHaveBeenCalled();
	});
});
