import { afterEach, describe, expect, it, vi } from "vitest";
import {
	appearanceKey,
	parseAppearance,
	readAppearance,
	subscribeAppearance,
	writeAppearance,
} from "../../src/components/appearance";
import {
	defaultProjectList,
	parseProjectList,
	projectListHref,
	rememberProjectListScroll,
} from "../../src/components/project-list-navigation";
import { projectFiltersSchema } from "../../src/lib/project-folders";

afterEach(() => {
	if (typeof window !== "undefined" && "dispatchEvent" in window)
		writeAppearance("system");
	vi.unstubAllGlobals();
});
describe("entry appearance preference", () => {
	it("accepts only device appearance choices", () => {
		for (const mode of ["light", "dark"] as const)
			expect(parseAppearance(mode)).toBe(mode);
		for (const mode of [null, "system", "__proto__", "dark;url(x)", "unknown"])
			expect(parseAppearance(mode)).toBe("system");
	});
	it("persists only a theme and notifies mounted surfaces", () => {
		let stored: string | null = null;
		const target = Object.assign(new EventTarget(), {
			localStorage: {
				getItem: vi.fn(() => stored),
				setItem: vi.fn((_key: string, value: string) => {
					stored = value;
				}),
			},
		});
		vi.stubGlobal("window", target);
		const changed = vi.fn(),
			off = subscribeAppearance(changed);
		writeAppearance("dark");
		expect(target.localStorage.setItem).toHaveBeenCalledWith(
			appearanceKey,
			"dark",
		);
		expect(readAppearance()).toBe("dark");
		expect(changed).toHaveBeenCalledTimes(1);
		off();
		writeAppearance("light");
		expect(changed).toHaveBeenCalledTimes(1);
	});
	it("keeps the selector usable when writes are blocked but reads still work", () => {
		vi.stubGlobal(
			"window",
			Object.assign(new EventTarget(), {
				localStorage: {
					getItem: () => null,
					setItem: () => {
						throw new Error("storage blocked");
					},
				},
			}),
		);
		writeAppearance("dark");
		expect(readAppearance()).toBe("dark");
		writeAppearance("light");
		expect(readAppearance()).toBe("light");
	});
	it("follows another tab's setting and handles a cleared device preference", () => {
		let stored: string | null = "dark";
		const target = Object.assign(new EventTarget(), {
			localStorage: {
				getItem: () => stored,
				setItem: (_key: string, value: string) => {
					stored = value;
				},
			},
		});
		vi.stubGlobal("window", target);
		writeAppearance("dark");
		const changed = vi.fn(),
			off = subscribeAppearance(changed);
		stored = "light";
		target.dispatchEvent(
			Object.assign(new Event("storage"), {
				key: appearanceKey,
				newValue: "light",
			}),
		);
		expect(changed).toHaveBeenCalledTimes(1);
		expect(readAppearance()).toBe("light");
		stored = null;
		target.dispatchEvent(
			Object.assign(new Event("storage"), { key: null, newValue: null }),
		);
		expect(readAppearance()).toBe("system");
		off();
	});
});
describe("project list navigation", () => {
	it("restores filters without carrying authority or cursor parameters", () => {
		const folderId = "00000000-0000-4000-8000-000000000001";
		const params = new URLSearchParams({
			folderId,
			status: "archived",
			q: "  支座 & CAD  ",
			ownerId: "forged",
			cursor: "other-scope",
			token: "private",
		});
		const parsed = parseProjectList(params);
		expect(parsed).toEqual({ folderId, status: "archived", q: "支座 & CAD" });
		expect(
			parseProjectList(
				new URLSearchParams(projectListHref(parsed).split("?")[1]),
			),
		).toEqual(parsed);
		expect(projectListHref(parsed)).not.toMatch(/ownerId|cursor|token/);
		expect(projectFiltersSchema.safeParse(parsed).success).toBe(true);
	});
	it("bounds malformed input and keeps a canonical local path", () => {
		const parsed = parseProjectList(
			new URLSearchParams({
				folderId: "https://untrusted.example",
				status: "deleted",
				q: "x".repeat(300),
			}),
		);
		expect(parsed.folderId).toBe("");
		expect(parsed.status).toBe("active");
		expect(parsed.q).toHaveLength(200);
		expect(projectListHref(defaultProjectList)).toBe("/projects");
		expect(
			projectListHref({
				...defaultProjectList,
				q: "//evil.test?token=x#fragment",
			}),
		).toMatch(/^\/projects\?q=%2F%2F/);
	});
	it("keeps the existing unclassified scope supported by the API", () => {
		const parsed = parseProjectList(
			new URLSearchParams("folderId=none&status=all"),
		);
		expect(parsed).toEqual({ folderId: "none", status: "all", q: "" });
	});
	it("saves only scroll alongside the framework's existing history state", () => {
		const replaceState = vi.fn();
		vi.stubGlobal("window", {
			scrollY: 420,
			location: { href: "https://app.test/projects?status=archived" },
			history: { state: { __NA: true, tree: "framework" }, replaceState },
		});
		rememberProjectListScroll();
		expect(replaceState).toHaveBeenCalledWith(
			{ __NA: true, tree: "framework", pmListScroll: 420 },
			"",
			"https://app.test/projects?status=archived",
		);
	});
});
