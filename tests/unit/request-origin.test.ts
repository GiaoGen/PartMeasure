import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const csrfValue = "a".repeat(43);
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: csrfValue }) }) }));
import { writeOriginAllowed } from "../../src/lib/request-origin";
import { appWriteOrigins } from "../../src/lib/server/origin";
import { csrf, sameOrigin } from "../../src/lib/server/http";

afterEach(() => vi.unstubAllEnvs());
const request = (origin?: string, site = "same-origin", csrfToken?: string) => new Request("http://127.0.0.1:3000/api/projects", {
	method: "POST",
	headers: { ...(origin ? { origin } : {}), "sec-fetch-site": site, ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) },
});
function localConfig() {
	vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
	vi.stubEnv("VERCEL", "");
	vi.stubEnv("VERCEL_ENV", "");
}
describe("configured write origins and unchanged CSRF boundary", () => {
	it("accepts both local loopback names on the configured port", async () => {
		localConfig();
		expect(() => sameOrigin(request("http://localhost:3000"))).not.toThrow();
		await expect(csrf(request("http://localhost:3000", "same-origin", csrfValue))).resolves.toBeUndefined();
		await expect(csrf(request("http://127.0.0.1:3000", "same-origin", csrfValue))).resolves.toBeUndefined();
	});
	it.each([undefined, "null", "http://localhost:3001", "https://localhost:3000", "http://localhost.evil:3000", "http://192.168.1.2:3000", "http://evil.test:3000"])("rejects untrusted local origin %s", (origin) => {
		localConfig();
		expect(() => sameOrigin(request(origin))).toThrowError(expect.objectContaining({ code: "ORIGIN_MISMATCH", status: 403 }));
	});
	it("still rejects cross-site and missing/forged CSRF tokens for valid local aliases", async () => {
		localConfig();
		expect(() => sameOrigin(request("http://127.0.0.1:3000", "cross-site"))).toThrow();
		await expect(csrf(request("http://localhost:3000"))).rejects.toMatchObject({ code: "CSRF_INVALID" });
		await expect(csrf(request("http://localhost:3000", "same-origin", "b".repeat(43)))).rejects.toMatchObject({ code: "CSRF_INVALID" });
	});
	it("accepts only the exact configured deployment and trusted Preview branch alias", () => {
		localConfig();
		vi.stubEnv("VERCEL", "1");
		vi.stubEnv("VERCEL_ENV", "preview");
		vi.stubEnv("VERCEL_URL", "example-build.vercel.app");
		vi.stubEnv("VERCEL_BRANCH_URL", "example-git-p0.vercel.app");
		expect(appWriteOrigins()).toEqual(["https://example-build.vercel.app", "https://example-git-p0.vercel.app"]);
		for (const origin of appWriteOrigins()) expect(() => sameOrigin(request(origin))).not.toThrow();
		for (const origin of ["http://localhost:3000", "https://other.vercel.app", "https://example-git-p0.vercel.app.evil"])
			expect(() => sameOrigin(request(origin))).toThrow();
		vi.stubEnv("VERCEL_BRANCH_URL", "example-git-p0.vercel.app/evil");
		expect(appWriteOrigins()).toHaveLength(1);
	});
	it("does not enable loopback aliases for a non-loopback configured site or a hosted process", () => {
		expect(writeOriginAllowed(request("http://localhost:3000"), ["https://app.example.test"], true)).toBe(false);
		expect(writeOriginAllowed(request("http://localhost:3000"), ["http://127.0.0.1:3000"], false)).toBe(false);
	});
});
