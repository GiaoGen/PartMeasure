import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/server/auth", () => ({ owner: vi.fn(), guest: vi.fn(), authClient: vi.fn() }));
vi.mock("../../src/lib/server/db", async original => ({ ...await original<object>(), transaction: vi.fn(), rate: vi.fn() }));
vi.mock("../../src/lib/server/http", async original => ({ ...await original<object>(), csrf: vi.fn() }));
vi.mock("../../src/lib/server/delivery-feedback-service", () => ({ listFeedback: vi.fn(), addFeedback: vi.fn() }));
import { GET, POST } from "../../src/app/api/[...segments]/route";
import { guest } from "../../src/lib/server/auth";
import { transaction } from "../../src/lib/server/db";
import { addFeedback, listFeedback } from "../../src/lib/server/delivery-feedback-service";
const project = "00000000-0000-4000-8000-000000000001";
const delivery = "00000000-0000-4000-8000-000000000002";
const key = "00000000-0000-4000-8000-000000000003";
const actor = { kind: "guest" as const, hash: "guest" };
function request(action: string, method = "GET", value?: unknown, query = "") {
	const segments = ["guest", "projects", project, "deliveries", delivery, action];
	return (method === "GET" ? GET : POST)(new Request(`http://127.0.0.1:3000/api/${segments.join("/")}${query}`, {
		method, headers: { "content-type": "application/json", "Idempotency-Key": key }, ...(value ? { body: JSON.stringify(value) } : {}),
	}), { params: Promise.resolve({ segments }) });
}
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(guest).mockResolvedValue(actor);
	vi.mocked(transaction).mockImplementation(async (_actor, work) => work({ query: async () => ({ rows: [{ id: project }] }) } as never));
	vi.mocked(addFeedback).mockResolvedValue({ id: delivery, kind: "received", createdAt: "now" });
	vi.mocked(listFeedback).mockResolvedValue({ items: [], total: 0, nextCursor: null, myReceipt: null, receipts: { received: 0, accepted: 0 } });
});
it("allows only the explicit feedback write path for Guest", async () => {
	expect((await request("feedback", "POST", { kind: "received" })).status).toBe(201);
	expect(addFeedback).toHaveBeenCalledWith(actor, project, delivery, { kind: "received", body: "", guestLabel: "" }, key);
	expect((await request("publish", "POST", {})).status).toBe(403);
});
it("rejects forged identity and inappropriate feedback query parameters", async () => {
	expect((await request("feedback", "POST", { kind: "accepted", guestSessionId: project })).status).toBe(422);
	expect((await request("feedback", "GET", undefined, "?unknown=1")).status).toBe(422);
	expect(addFeedback).not.toHaveBeenCalled();
});
it("reads the intended published-version feedback through the existing Guest preflight", async () => {
	const response = await request("feedback");
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toContain("no-store");
	expect(listFeedback).toHaveBeenCalledWith(actor, project, delivery, null);
});
