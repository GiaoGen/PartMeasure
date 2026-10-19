import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
const fake = vi.hoisted(() => ({
	change: (_p: string) => {},
	drop: () => {},
	off: vi.fn(),
	read: vi.fn(),
	user: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/server/auth", () => ({
	authClient: async () => ({ auth: { getUser: fake.user } }),
	guest: async () => ({ kind: "guest", hash: "hash" }),
}));
vi.mock("../../src/lib/server/db", () => ({
	transaction: async (_a: unknown, work: (db: object) => unknown) => work({}),
	rate: async () => {},
	digest: () => "digest",
}));
vi.mock("../../src/lib/server/project-changes", () => ({ projectChanges: fake.read }));
vi.mock("../../src/lib/server/session-notifications", () => ({
	SessionNotifications: class {
		async subscribe(subscriber: { change: (p: string) => void; dropped: () => void }) {
			fake.change = subscriber.change;
			fake.drop = subscriber.dropped;
			return fake.off;
		}
	},
}));
vi.mock("../../src/lib/server/http", () => ({
	uuid: { safeParse: () => ({ success: true }) },
}));
import { projectStream } from "../../src/lib/server/project-stream";
import { AppError } from "../../src/lib/policy";
const project = "00000000-0000-4000-8000-000000000000";
const batch = { sequence: "1", cursor: "opaque_cursor", reset: false, events: [] };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
	fake.off.mockReset();
	fake.user
		.mockReset()
		.mockResolvedValue({
			data: { user: { id: "owner", email_confirmed_at: "now" } },
			error: null,
		});
	fake.read.mockReset().mockImplementation(async (_a, _p, _c, send) => {
		send?.(batch);
		return batch;
	});
});
afterEach(() => vi.restoreAllMocks());
describe("SSE lifecycle without a browser (transport unit only)", () => {
	it("sends initial changes and live wakeups, releases listener on cancel", async () => {
		const response = await projectStream(
				new Request("http://localhost/events"),
				project,
				false,
			),
			reader = response.body?.getReader();
		expect(reader).toBeDefined();
		if (!reader) return;
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toContain("event: changes");
		expect(fake.read).toHaveBeenCalledTimes(1);
		expect(fake.user).toHaveBeenCalledTimes(1);
		fake.change(project);
		const next = await reader.read();
		expect(new TextDecoder().decode(next.value)).toContain("id: opaque_cursor");
		await reader.cancel();
		expect(fake.off).toHaveBeenCalledTimes(1);
	});
	it("revocation during an open stream dispatches unavailable and closes", async () => {
		const response = await projectStream(new Request("http://localhost/events"), project, true),
			reader = response.body?.getReader();
		if (!reader) throw Error("NO_BODY");
		await reader.read();
		await tick();
		fake.read.mockRejectedValue(new AppError("LINK_UNAVAILABLE", 401));
		fake.change(project);
		expect(new TextDecoder().decode((await reader.read()).value)).toContain(
			"event: unavailable",
		);
		expect((await reader.read()).done).toBe(true);
		expect(fake.off).toHaveBeenCalledTimes(1);
	});
	it("connection drop and abort never leave a pooled subscriber", async () => {
		const controller = new AbortController(),
			response = await projectStream(
				new Request("http://localhost/events", { signal: controller.signal }),
				project,
				false,
			),
			reader = response.body?.getReader();
		if (!reader) throw Error("NO_BODY");
		await reader.read();
		fake.drop();
		expect((await reader.read()).done).toBe(true);
		controller.abort();
		expect(fake.off).toHaveBeenCalledTimes(1);
	});
	it("permission errors before opening retain their HTTP status and clean up", async () => {
		fake.read.mockRejectedValueOnce(new AppError("NOT_FOUND", 404));
		await expect(
			projectStream(new Request("http://localhost/events"), project, false),
		).rejects.toMatchObject({ status: 404 });
		expect(fake.off).toHaveBeenCalledTimes(1);
	});
});
