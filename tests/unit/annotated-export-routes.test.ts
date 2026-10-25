import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/server/auth", () => ({
	owner: vi.fn(),
	guest: vi.fn(),
	authClient: vi.fn(),
}));
vi.mock("../../src/lib/server/annotated-export-service", () => ({
	annotatedExport: vi.fn(),
}));
vi.mock("../../src/lib/server/db", async (original) => ({
	...(await original<object>()),
	transaction: vi.fn(async () => null),
	rate: vi.fn(),
}));
import { GET } from "../../src/app/api/[...segments]/route";
import { owner, guest } from "../../src/lib/server/auth";
import { annotatedExport } from "../../src/lib/server/annotated-export-service";
import { AppError } from "../../src/lib/policy";
const id = "00000000-0000-4000-8000-000000000001";
function request(suffix = "", isGuest = false) {
	const path = `${isGuest ? "guest/" : ""}projects/${id}/files/${id}/annotated-export${suffix}`;
	return GET(new Request(`http://127.0.0.1:3000/api/${path}`), {
		params: Promise.resolve({
			segments: (path.split("?")[0] ?? "").split("/"),
		}),
	});
}
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(owner).mockResolvedValue({ kind: "owner", id });
	vi.mocked(guest).mockResolvedValue({ kind: "guest", hash: "hash" });
	vi.mocked(annotatedExport).mockResolvedValue({
		snapshotId: "fixed",
	} as never);
});
it.each([false, true])(
	"uses the verified actor and returns a private noncached snapshot (Guest=%s)",
	async (isGuest) => {
		const response = await request("", isGuest);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(annotatedExport).toHaveBeenCalledWith(
			isGuest ? { kind: "guest", hash: "hash" } : { kind: "owner", id },
			id,
			id,
		);
	},
);
it("rejects client draft/selection queries and deeper paths", async () => {
	for (const suffix of ["?draft=1", "?purpose=delivery", "?revision=2"])
		expect((await request(suffix)).status).toBe(422);
	expect(annotatedExport).not.toHaveBeenCalled();
	expect((await request("/extra")).status).toBe(404);
});
it("preserves revoke, cross-project and resource-limit rejection", async () => {
	for (const [code, status] of [
		["LINK_UNAVAILABLE", 401],
		["NOT_FOUND", 404],
		["EXPORT_LIMIT", 413],
	] as const) {
		vi.mocked(annotatedExport).mockRejectedValueOnce(
			new AppError(code, status),
		);
		expect((await request("", true)).status).toBe(status);
	}
});
