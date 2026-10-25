import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../src/lib/server/zip-package-service", () => ({
	zipSnapshot: vi.fn(),
	zipAccess: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/server/auth", () => ({
	owner: vi.fn(),
	guest: vi.fn(),
	authClient: vi.fn(),
}));
vi.mock("../../src/lib/server/annotated-export-service", () => ({
	annotatedExport: vi.fn(),
}));
vi.mock("../../src/lib/server/pdf-report-service", () => ({
	pdfReport: vi.fn(),
}));
vi.mock("../../src/lib/server/db", async (original) => ({
	...(await original<object>()),
	transaction: vi.fn(async () => null),
	rate: vi.fn(),
}));
import { GET } from "../../src/app/api/[...segments]/route";
import { owner, guest } from "../../src/lib/server/auth";
import { annotatedExport } from "../../src/lib/server/annotated-export-service";
import { pdfReport } from "../../src/lib/server/pdf-report-service";
import {
	zipSnapshot,
	zipAccess,
} from "../../src/lib/server/zip-package-service";
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
	vi.mocked(pdfReport).mockResolvedValue({ snapshotId: "pdf-fixed" } as never);
	vi.mocked(zipSnapshot).mockResolvedValue({
		snapshotId: "zip-fixed",
	} as never);
	vi.mocked(zipAccess).mockResolvedValue({ files: [] });
});
function requestZip(query: string, isGuest = false, check = false) {
	const path = `${isGuest ? "guest/" : ""}projects/${id}/${check ? "zip-access" : "zip-snapshot"}`;
	return GET(new Request(`http://127.0.0.1:3000/api/${path}?${query}`), {
		params: Promise.resolve({ segments: path.split("/") }),
	});
}
it.each([false, true])(
	"forwards exact ZIP scope with private headers (Guest=%s)",
	async (isGuest) => {
		const response = await requestZip(
			`materials=${id}&delivery=${id}&attachments=${id}`,
			isGuest,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(zipSnapshot).toHaveBeenCalledWith(
			isGuest ? { kind: "guest", hash: "hash" } : { kind: "owner", id },
			id,
			{ materialIds: [id], originals: false, delivery: { id, fileIds: [id] } },
		);
	},
);
it("fresh ZIP access uses the same validated scope", async () => {
	expect(
		(await requestZip(`materials=${id}&originals=1`, false, true)).status,
	).toBe(200);
	expect(zipAccess).toHaveBeenCalledWith({ kind: "owner", id }, id, {
		materialIds: [id],
		originals: true,
		delivery: null,
	});
});
it("rejects invalid ZIP scope and excess material IDs before the service", async () => {
	const many = Array.from(
		{ length: 21 },
		(_, n) => `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
	).join(",");
	for (const query of [
		"",
		`materials=${id},${id}`,
		`materials=${id}&draft=1`,
		`materials=${id}&originals=yes`,
		`delivery=${id}`,
		`materials=${many}`,
	])
		expect((await requestZip(query)).status).toBe(422);
	expect(zipSnapshot).not.toHaveBeenCalled();
});
it("preserves ZIP original permission, revocation and resource rejections", async () => {
	for (const [code, status] of [
		["FORBIDDEN", 403],
		["LINK_UNAVAILABLE", 401],
		["ZIP_LIMIT", 413],
	] as const) {
		vi.mocked(zipSnapshot).mockRejectedValueOnce(new AppError(code, status));
		expect((await requestZip(`materials=${id}`, true)).status).toBe(status);
	}
});
function requestPdf(query: string, isGuest = false) {
	const path = `${isGuest ? "guest/" : ""}projects/${id}/pdf-report`;
	return GET(new Request(`http://127.0.0.1:3000/api/${path}?${query}`), {
		params: Promise.resolve({ segments: path.split("/") }),
	});
}
it.each([false, true])(
	"forwards the exact PDF selection to verified role (Guest=%s)",
	async (isGuest) => {
		const other = "00000000-0000-4000-8000-000000000002",
			response = await requestPdf(`ids=${other},${id}`, isGuest);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(pdfReport).toHaveBeenCalledWith(
			isGuest ? { kind: "guest", hash: "hash" } : { kind: "owner", id },
			id,
			[other, id],
		);
	},
);
it("rejects duplicate, missing, excessive or unsupported PDF selection input", async () => {
	const nine = Array.from(
		{ length: 9 },
		(_, n) => `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
	).join(",");
	for (const query of [
		"",
		"ids=x",
		`ids=${id},${id}`,
		`ids=${id}&ids=${id}`,
		`ids=${id}&draft=1`,
		`ids=${nine}`,
	])
		expect((await requestPdf(query)).status).toBe(422);
	expect(pdfReport).not.toHaveBeenCalled();
});
it("preserves PDF resource and revoked-access rejections", async () => {
	vi.mocked(pdfReport).mockRejectedValueOnce(new AppError("PDF_LIMIT", 413));
	expect((await requestPdf(`ids=${id}`)).status).toBe(413);
	vi.mocked(pdfReport).mockRejectedValueOnce(
		new AppError("LINK_UNAVAILABLE", 401),
	);
	expect((await requestPdf(`ids=${id}`, true)).status).toBe(401);
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
