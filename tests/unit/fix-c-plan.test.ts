import { describe, expect, it } from "vitest";
import { boundedAssets, once, options, projectScope, publicProgress, type Asset, type Journal } from "../../scripts/fix-c/model";

describe("FIX-C offline scope and write checkpoints (no cloud calls)", () => {
	it("defaults to offline prepare and refuses target overrides or implicit apply", () => {
		expect(options([])).toEqual({ mode: "prepare" });
		const run = "01234567-1234-4123-8123-0123456789ab";
		expect(options(["--apply", "--run", run, "--phase", "seed"])).toEqual({ mode: "apply", run, phase: "seed" });
		expect(options(["--review-source", run])).toEqual({ mode: "review-source", run });
		for (const args of [["--apply"], ["--run", run], ["--inspect", "../other"], ["--apply", "--run", run, "--phase", "cleanup"], ["--target", "old-project"]])
			expect(() => options(args)).toThrow();
	});
	it("bounds the shared batch to four assets and 4MiB", () => {
		const assets: Asset[] = ["image", "v1", "v2", "private"].map(key => ({ key, filename: "synthetic.step", mime: "application/step", purpose: "delivery", bytes: 100, sha256: "a".repeat(64) }));
		expect(() => boundedAssets(assets)).not.toThrow();
		for (const changed of [assets.slice(1), [...assets, assets[0] as Asset], assets.map(a => ({ ...a, bytes: 2 * 1024 * 1024 }))])
			expect(() => boundedAssets(changed)).toThrow();
	});
	it("does not send before durable pending; refuses an ambiguous retry", async () => {
		const journal: Journal = { operations: {} }, order: string[] = [];
		const save = async () => { order.push(journal.operations.upload?.status ?? "missing"); };
		await expect(once(journal, "upload", { bytes: 12 }, () => "secret-idempotency", save, async () => { order.push("sent"); throw Error("timeout with private URL"); })).rejects.toThrow();
		expect(order).toEqual(["pending", "sent"]);
		await expect(once(journal, "upload", { bytes: 12 }, () => "other", save, async () => { throw Error("MUST_NOT_SEND"); })).rejects.toThrow("FIX_C_PENDING_REQUIRES_RECONCILIATION");
		expect(order).toEqual(["pending", "sent"]);
		expect(JSON.stringify(publicProgress(journal))).not.toMatch(/secret|private|bytes/);
	});
	it("reuses completed responses but rejects a changed operation", async () => {
		const journal: Journal = { operations: {} };
		const save = async () => {};
		expect(await once(journal, "project", {}, () => "key", save, async () => ({ id: "01234567-1234-4123-8123-0123456789ab", name: "FIX-C-synthetic" }))).toHaveProperty("id");
		await once(journal, "project", {}, () => "key", save, async () => { throw Error("MUST_NOT_SEND"); });
		expect(projectScope(journal)).toBe("01234567-1234-4123-8123-0123456789ab");
		await expect(once(journal, "project", { target: "old" }, () => "key", save, async () => ({}))).rejects.toThrow("FIX_C_OPERATION_CHANGED");
		expect(() => projectScope({ operations: {} })).toThrow();
	});
});
