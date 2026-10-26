import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), rate: vi.fn(), origin: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/server/db", () => ({ digest: (value: string) => `hash:${value}`, transaction: mocks.transaction, rate: mocks.rate }));
vi.mock("../../src/lib/server/origin", () => ({ appOrigin: mocks.origin }));
beforeEach(() => {
	vi.resetModules(); vi.clearAllMocks();
	vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", ""); vi.stubEnv("VERCEL_ENV", "");
	mocks.origin.mockReturnValue("http://127.0.0.1:3000");
	mocks.transaction.mockRejectedValue(Error("DB_OFFLINE"));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("lightweight local credential throttling", () => {
	it("reaches authentication without a business database in loopback development", async () => {
		const { throttleAuth } = await import("../../src/lib/server/auth-throttle");
		await throttleAuth("auth", "user@example.test");
		expect(mocks.transaction).not.toHaveBeenCalled();
	});
	it("limits normalized email attempts and releases them after ten minutes", async () => {
		vi.useFakeTimers();
		const { throttleAuth } = await import("../../src/lib/server/auth-throttle");
		for (let n = 0; n < 5; n++) await throttleAuth("auth", "USER@example.test");
		await expect(throttleAuth("auth", "user@example.test")).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
		vi.advanceTimersByTime(600001);
		await expect(throttleAuth("auth", "user@example.test")).resolves.toBeUndefined();
	});
	it("caps total attempts and maintains a separate OTP budget", async () => {
		const { throttleAuth } = await import("../../src/lib/server/auth-throttle");
		for (let n = 0; n < 100; n++) await throttleAuth("auth", `${n}@example.test`);
		await expect(throttleAuth("auth", "new@example.test")).rejects.toMatchObject({ code: "RATE_LIMITED" });
		for (let n = 0; n < 10; n++) await throttleAuth("verify", "user@example.test");
		await expect(throttleAuth("verify", "user@example.test")).rejects.toMatchObject({ code: "RATE_LIMITED" });
	});
	it.each(["production", "test"])("preserves durable throttling in %s without an automatic fallback", async environment => {
		vi.stubEnv("NODE_ENV", environment);
		const { throttleAuth } = await import("../../src/lib/server/auth-throttle");
		await expect(throttleAuth("auth", "user@example.test")).rejects.toThrow("DB_OFFLINE");
		expect(mocks.transaction).toHaveBeenCalledTimes(1);
	});
	it("keeps deployed and non-loopback environments on existing database limits", async () => {
		mocks.transaction.mockImplementation(async (_actor, work) => work("DB"));
		vi.stubEnv("VERCEL_ENV", "preview");
		const { throttleAuth } = await import("../../src/lib/server/auth-throttle");
		await throttleAuth("auth", "USER@example.test");
		expect(mocks.rate.mock.calls).toEqual([["DB", "auth:global", 100, 600], ["DB", "auth:hash:user@example.test", 5, 600]]);
		vi.stubEnv("VERCEL_ENV", ""); mocks.origin.mockReturnValue("https://example.test");
		await throttleAuth("verify", "user@example.test");
		expect(mocks.rate).toHaveBeenLastCalledWith("DB", "verify:hash:user@example.test", 10, 600);
	});
});
