import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ inRequest: false, client: {}, capture: vi.fn(), verify: vi.fn(), file: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/server/auth", () => ({
	authClient: async () => { if (!fake.inRequest) throw Error("cookies outside request scope"); fake.capture(); return fake.client; },
	verifiedOwner: fake.verify,
	// The former implementation reacquired request cookies during the stream.
	owner: async () => { if (!fake.inRequest) throw Error("cookies outside request scope"); return fake.verify(fake.client); },
}));
vi.mock("../../src/lib/server/service", () => ({ fileForRead: fake.file }));
import { fileAuthorizer } from "../../src/lib/server/file-authorizer";
import { AppError } from "../../src/lib/policy";
beforeEach(() => {
	vi.useFakeTimers(); vi.setSystemTime(1000); fake.inRequest = true;
	fake.capture.mockReset(); fake.verify.mockReset().mockResolvedValue({ kind: "owner", id: "A" }); fake.file.mockReset().mockResolvedValue({ storage_key: "private" });
});
afterEach(() => vi.useRealTimers());
it("captures the request client before streaming and freshly verifies the same Owner outside that scope", async () => {
	const authorize = await fileAuthorizer({ kind: "owner", id: "A" }, "P", "F");
	expect(fake.capture).toHaveBeenCalledTimes(1);
	fake.inRequest = false;
	await authorize(); expect(fake.verify).not.toHaveBeenCalled();
	vi.setSystemTime(6001); await authorize();
	expect(fake.verify).toHaveBeenCalledWith(fake.client);
	expect(fake.capture).toHaveBeenCalledTimes(1);
	expect(fake.file).toHaveBeenCalledTimes(2);
});
it("still refuses lost or changed identities before returning further file access", async () => {
	const authorize = await fileAuthorizer({ kind: "owner", id: "A" }, "P", "F");
	fake.inRequest = false; vi.setSystemTime(6001);
	fake.verify.mockRejectedValueOnce(new AppError("AUTH_REQUIRED", 401));
	await expect(authorize()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
	fake.verify.mockResolvedValueOnce({ kind: "owner", id: "B" });
	await expect(authorize()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
	expect(fake.file).not.toHaveBeenCalled();
});
it("keeps Guest project/link/file checks on every read without creating an Owner client", async () => {
	const authorize = await fileAuthorizer({ kind: "guest", hash: "guest" }, "P", "F");
	fake.inRequest = false; await authorize(); vi.setSystemTime(6001);
	fake.file.mockRejectedValueOnce(new AppError("LINK_UNAVAILABLE", 401));
	await expect(authorize()).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
	expect(fake.file).toHaveBeenCalledTimes(2); expect(fake.capture).not.toHaveBeenCalled(); expect(fake.verify).not.toHaveBeenCalled();
});
