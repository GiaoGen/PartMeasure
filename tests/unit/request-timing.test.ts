import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { timed, withRequestTiming } from "../../src/lib/server/timing";
afterEach(() => vi.unstubAllEnvs());

describe("opt-in request timing", () => {
	it("is disabled by default and preserves no-store", async () => {
		vi.stubEnv("PM_SERVER_TIMING", "0");
		const response = await withRequestTiming(async () => new Response("ok", { headers: { "Cache-Control": "private, no-store" } }));
		expect(response.headers.get("Server-Timing")).toBeNull();
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
	});
	it("isolates overlapping requests and reports only fixed durations/counts", async () => {
		vi.stubEnv("PM_SERVER_TIMING", "1");
		const [a, b] = await Promise.all([
			withRequestTiming(async () => { await timed("auth", async () => "not-logged"); return new Response("a"); }),
			withRequestTiming(async () => { await timed("sql", async () => "not-logged"); return new Response("b"); }),
		]);
		expect(a.headers.get("Server-Timing")).toMatch(/auth;dur=[\d.]+, auth_count;desc="1"/);
		expect(a.headers.get("Server-Timing")).not.toContain("sql");
		expect(b.headers.get("Server-Timing")).toContain('sql_count;desc="1"');
		expect(b.headers.get("Server-Timing")).not.toContain("auth");
		expect(a.headers.get("Server-Timing")).not.toContain("not-logged");
	});
});
