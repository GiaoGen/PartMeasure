import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("pg", () => ({ default: { Pool: class { connect = fake.connect; on() {} } } }));
import { transaction } from "../../src/lib/server/db";
beforeEach(() => { vi.stubEnv("DATABASE_URL", "postgres://partmeasure_runtime:local@127.0.0.1:5432/disposable"); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllEnvs());
function lease() {
	const client = Object.assign(new EventEmitter(), { query: vi.fn(async () => ({ rows: [{ role: "partmeasure_runtime" }] })), release: vi.fn() });
	fake.connect.mockResolvedValue(client); return client;
}
it("captures a leased connection's asynchronous between-query failure and discards it without commit or network retry", async () => {
	const client = lease(), failure = new Error("Connection terminated unexpectedly");
	await expect(transaction({ kind: "owner", id: "A" }, async () => {
		expect(() => client.emit("error", failure)).not.toThrow();
		await Promise.resolve(); return "must not succeed";
	})).rejects.toBe(failure);
	expect(client.release).toHaveBeenCalledWith(true);
	expect(client.query.mock.calls.some(args => (args as unknown[])[0] === "commit")).toBe(false);
	expect(fake.connect).toHaveBeenCalledTimes(1);
	expect(client.listenerCount("error")).toBe(0);
});
it("releases healthy leases and removes the temporary listener", async () => {
	const client = lease();
	await expect(transaction({ kind: "owner", id: "A" }, async () => "ok")).resolves.toBe("ok");
	expect(client.release).toHaveBeenCalledWith(false); expect(client.listenerCount("error")).toBe(0);
});
