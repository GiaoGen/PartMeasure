import { afterEach, describe, expect, it, vi } from "vitest";
import { clearApiSession } from "../../src/components/api";
import {
	clearSavedShares,
	forgetSavedShare,
	readSavedShare,
	saveShare,
} from "../../src/components/saved-share-links";

class MemoryStorage {
	values = new Map<string, string>();
	get length() {
		return this.values.size;
	}
	key(i: number) {
		return [...this.values.keys()][i] ?? null;
	}
	getItem(key: string) {
		return this.values.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.values.set(key, value);
	}
	removeItem(key: string) {
		this.values.delete(key);
	}
}
const origin = "https://example.test";
// Intentionally synthetic capability, never a real project link.
const url = `${origin}/s/${"t".repeat(43)}`;
const share = {
	id: "share-A",
	expiresAt: "2099-01-01T00:00:00Z",
	revokedAt: null,
};
function setup() {
	const store = new MemoryStorage();
	vi.stubGlobal("window", { localStorage: store, dispatchEvent: vi.fn() });
	return store;
}
afterEach(() => vi.unstubAllGlobals());
describe("owner's saved share copies", () => {
	it("restores across reads only with matching project and current server link metadata", () => {
		setup();
		expect(saveShare("P", share, url)).toBe(true);
		expect(readSavedShare("P", share, origin)).toBe(url);
		expect(readSavedShare("P", share, origin)).toBe(url);
		expect(readSavedShare("Q", share, origin)).toBe("");
		expect(readSavedShare("P", null, origin)).toBe("");
	});
	it("hides mismatched rotations without deleting a newer tab's saved copy", () => {
		setup();
		saveShare("P", { ...share, id: "new" }, url);
		expect(readSavedShare("P", share, origin)).toBe("");
		expect(readSavedShare("P", { ...share, id: "new" }, origin)).toBe(url);
	});
	it("removes revoked or expired copies", () => {
		const store = setup();
		saveShare("P", share, url);
		expect(
			readSavedShare(
				"P",
				{ ...share, revokedAt: "2026-10-21T00:00:00Z" },
				origin,
			),
		).toBe("");
		expect(store.length).toBe(0);
		saveShare("P", share, url);
		expect(readSavedShare("P", share, origin, Date.parse("2100-01-01"))).toBe(
			"",
		);
		expect(store.length).toBe(0);
	});
	it("rejects foreign origins, executable paths and added query/hash data", () => {
		setup();
		for (const candidate of [
			url.replace(origin, "https://other.test"),
			`${origin}/login`,
			`${url}?x=1`,
			`${url}#x`,
			"javascript:alert(1)",
		]) {
			saveShare("P", share, candidate);
			expect(readSavedShare("P", share, origin)).toBe("");
		}
	});
	it("clears on identity invalidation but survives page-exit memory cleanup", () => {
		setup();
		saveShare("P", share, url);
		clearApiSession(true);
		expect(readSavedShare("P", share, origin)).toBe(url);
		clearApiSession();
		expect(readSavedShare("P", share, origin)).toBe("");
	});
	it("bounds saved records and leaves unrelated preferences untouched", () => {
		const store = setup();
		store.setItem("theme", "blue");
		for (let i = 0; i < 40; i++) saveShare(`P${i}`, share, url);
		expect(store.length).toBe(33);
		forgetSavedShare("P39");
		expect(readSavedShare("P39", share, origin)).toBe("");
		clearSavedShares();
		expect(store.getItem("theme")).toBe("blue");
	});
	it("fails softly when browser storage is blocked", () => {
		const blocked = Object.defineProperty({}, "localStorage", {
			get() {
				throw new Error("blocked");
			},
		});
		vi.stubGlobal("window", blocked);
		expect(saveShare("P", share, url)).toBe(false);
		expect(readSavedShare("P", share, origin)).toBe("");
		expect(() => clearSavedShares()).not.toThrow();
	});
});
