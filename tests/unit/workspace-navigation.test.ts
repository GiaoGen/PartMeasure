import { afterEach, describe, expect, it, vi } from "vitest";
import {
	historyMarker,
	parseWorkspaceView,
	safeProjectListReturn,
	workspaceHref,
} from "../../src/components/workspace-navigation";
import { motionDuration } from "../../src/components/ui-motion";

const file = "00000000-0000-4000-8000-000000000001";
const annotation = "00000000-0000-4000-8000-000000000002";
afterEach(() => vi.unstubAllGlobals());

describe("workspace view locations", () => {
	it("round trips file, annotation, section and filters without authority or draft data", () => {
		const current = new URL(
			`https://app.test/projects/${file}?from=${encodeURIComponent("/projects?status=archived&q=支座")}&token=secret&cursor=private`,
		);
		const view = parseWorkspaceView(
			new URLSearchParams({
				section: "files",
				type: "image",
				sort: "name-asc",
				file,
				annotation,
				panel: "annotation",
			}),
		);
		const href = workspaceHref(current, view, false);
		expect(parseWorkspaceView(new URL(href, current).searchParams)).toEqual(
			view,
		);
		expect(new URL(href, current).searchParams.get("from")).toBe(
			"/projects?status=archived&q=%E6%94%AF%E5%BA%A7",
		);
		expect(href).not.toMatch(/token|secret|cursor|private/);
	});
	it("keeps Guest project scope and drops owner return context", () => {
		const current = new URL(
			`https://app.test/s/session?project=${file}&from=/projects&token=secret`,
		);
		const href = workspaceHref(
			current,
			parseWorkspaceView(new URLSearchParams("section=deliveries")),
			true,
		);
		expect(new URL(href, current).searchParams.get("project")).toBe(file);
		expect(href).not.toMatch(/from|token/);
	});
	it("rejects malformed locators, conflicting issue selection and unknown filters", () => {
		expect(
			parseWorkspaceView(
				new URLSearchParams({
					file: "../private",
					annotation,
					panel: "annotation",
					type: "deleted",
					sort: "unknown",
					section: "admin",
				}),
			),
		).toEqual({
			section: "files",
			type: "all",
			sort: "created-desc",
			fileId: null,
			annotationId: null,
			issueId: null,
			quick: false,
		});
		expect(
			parseWorkspaceView(new URLSearchParams({ file, issue: annotation }))
				.issueId,
		).toBeNull();
		expect(
			parseWorkspaceView(new URLSearchParams({ issue: annotation })).issueId,
		).toBe(annotation);
	});
	it("accepts only canonical local project list returns", () => {
		for (const value of [
			null,
			"//evil.test/projects",
			"https://evil.test/projects",
			"/projects/other",
			"/projects#x",
			"/projects?x=\\evil",
		])
			expect(safeProjectListReturn(value)).toBe("/projects");
		expect(
			safeProjectListReturn("/projects?status=all&owner=forged&cursor=x"),
		).toBe("/projects?status=all");
	});
	it("scopes history counters to one workspace and requires safe integers", () => {
		expect(
			historyMarker({ pmWorkspace: { scope: "a", index: -1 } }, "a"),
		).toEqual({ scope: "a", index: -1 });
		for (const state of [
			null,
			{},
			{ pmWorkspace: { scope: "b", index: 1 } },
			{ pmWorkspace: { scope: "a", index: Infinity } },
			{ pmWorkspace: { scope: "a", index: "1" } },
		])
			expect(historyMarker(state, "a")).toBeNull();
	});
});
describe("shared motion preference", () => {
	it("removes JavaScript exit delays when the device requests reduced motion", () => {
		vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
		expect(motionDuration("enter")).toBe(0);
		expect(motionDuration("exit")).toBe(0);
	});
});
