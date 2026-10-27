import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/server/auth", () => ({ owner: vi.fn(), guest: vi.fn(), authClient: vi.fn() }));
vi.mock("../../src/lib/server/http", async original => ({ ...await original<object>(), csrf: vi.fn() }));
vi.mock("../../src/lib/server/db", async original => ({ ...await original<object>(), transaction: vi.fn(), rate: vi.fn() }));
vi.mock("../../src/lib/server/origin", () => ({ appOrigin: () => "http://127.0.0.1:3000" }));
import { POST } from "../../src/app/api/[...segments]/route";
import { authClient } from "../../src/lib/server/auth";
import { transaction } from "../../src/lib/server/db";
const signIn = vi.fn();
const verifyOtp = vi.fn();
beforeEach(() => {
	vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", ""); vi.stubEnv("VERCEL_ENV", "");
	vi.mocked(transaction).mockRejectedValue(Error("DB_OFFLINE"));
	vi.mocked(authClient).mockResolvedValue({ auth: { signInWithPassword: signIn, verifyOtp } } as never);
});
afterEach(() => vi.unstubAllEnvs());
function login(email: string) {
	return POST(new Request("http://127.0.0.1:3000/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "test-password-12345" }) }), { params: Promise.resolve({ segments: ["auth", "login"] }) });
}
it("uses real authentication's result despite an unavailable business database", async () => {
	signIn.mockResolvedValue({ data: { session: {}, user: {} }, error: null });
	expect((await login("valid@example.test")).status).toBe(200);
	expect(signIn).toHaveBeenCalledTimes(1); expect(transaction).not.toHaveBeenCalled();
});
it("still rejects bad credentials", async () => {
	signIn.mockResolvedValue({ error: { name: "AuthApiError", status: 400 } });
	expect((await login("invalid@example.test")).status).toBe(401);
});
it("reports Auth outages and provider throttling distinctly from a bad password", async () => {
	signIn.mockResolvedValue({ error: { name: "AuthRetryableFetchError", status: 0 } });
	expect((await login("offline@example.test")).status).toBe(503);
	signIn.mockResolvedValue({ error: { name: "AuthApiError", status: 429 } });
	expect((await login("limited@example.test")).status).toBe(429);
});
it("never counts an OTP dependency outage or throttle as rejection of an invalid or expired code", async () => {
	const verify = () => POST(new Request("http://127.0.0.1:3000/api/auth/verify", {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ email: "otp@example.test", token: "123456" }),
	}), { params: Promise.resolve({ segments: ["auth", "verify"] }) });
	for (const [error, status, code] of [
		[{ name: "AuthRetryableFetchError", status: 0 }, 503, "AUTH_UNAVAILABLE"],
		[{ name: "AuthApiError", status: 503 }, 503, "AUTH_UNAVAILABLE"],
		[{ name: "AuthApiError", status: 429 }, 429, "RATE_LIMITED"],
		[{ name: "AuthApiError", status: 403 }, 422, "OTP_INVALID_OR_EXPIRED"],
	] as const) {
		verifyOtp.mockResolvedValue({ error });
		const result = await verify();
		expect(result.status).toBe(status);
		expect((await result.json()).error.code).toBe(code);
	}
	verifyOtp.mockResolvedValue({ error: null });
	const success = await verify();
	expect(success.status).toBe(200);
	expect((await success.json()).data.verified).toBe(true);
});
