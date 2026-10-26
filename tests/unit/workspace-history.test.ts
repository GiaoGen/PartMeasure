import { describe, expect, it, vi } from "vitest";
import {
	WorkspaceHistory,
	type WorkspaceHistoryCallbacks,
} from "../../src/components/workspace-history";
import {
	parseWorkspaceView,
	sameWorkspaceContext,
} from "../../src/components/workspace-navigation";

const origin = "https://app.test",
	project = `${origin}/projects/demo`;
class HistoryHost extends EventTarget {
	entries: { href: string; state: unknown }[] = [
		{ href: `${origin}/projects`, state: { __NA: true } },
		{ href: `${project}?section=files`, state: { __NA: true } },
	];
	index = 1;
	location = { href: this.entries[1]?.href ?? project };
	navigation: (EventTarget & { currentEntry: { index: number } }) | undefined;
	constructor(modern: boolean) {
		super();
		if (modern) {
			this.navigation = Object.defineProperty(
				new EventTarget(),
				"currentEntry",
				{ get: () => ({ index: this.index }) },
			) as EventTarget & { currentEntry: { index: number } };
		}
	}
	history = {
		get state(): unknown {
			return null;
		},
		replaceState: vi.fn(
			(state: unknown, _unused: string, href: string | URL) => {
				const address = new URL(href, this.location.href).href;
				this.entries[this.index] = { href: address, state };
				this.location.href = address;
			},
		),
		pushState: vi.fn((state: unknown, _unused: string, href: string) => {
			const address = new URL(href, this.location.href).href;
			this.entries.splice(this.index + 1);
			this.entries.push({ href: address, state });
			this.index++;
			this.location.href = address;
		}),
		go: vi.fn((delta: number) => this.move(delta)),
	};
	move(delta: number, cancelable = true) {
		const nextIndex = this.index + delta,
			next = this.entries[nextIndex];
		if (!next) return;
		if (this.navigation) {
			// EventTarget is only a deterministic history harness, not a browser/E2E run.
			const event = Object.assign(new Event("navigate", { cancelable }), {
				navigationType: "traverse",
				destination: { url: next.href, sameDocument: true },
			});
			this.navigation.dispatchEvent(event);
			if (event.defaultPrevented) return;
		}
		this.index = nextIndex;
		this.location.href = next.href;
		this.dispatchEvent(
			Object.assign(new Event("popstate"), { state: next.state }),
		);
	}
}
function setup(modern: boolean, allowed: boolean) {
	const host = new HistoryHost(modern);
	Object.defineProperty(host.history, "state", {
		get: () => host.entries[host.index]?.state,
	});
	const callbacks: WorkspaceHistoryCallbacks = {
		canLeave: vi.fn(() => allowed),
		restore: vi.fn(),
		travel: vi.fn(),
	};
	const controller = new WorkspaceHistory(
		host as unknown as Window,
		"/api/projects/demo",
		false,
		() => callbacks,
	);
	return { host, callbacks, controller };
}
describe("workspace history cancellation", () => {
	it("cancels a native traversal before committing without truncating the forward branch", () => {
		const { host, callbacks, controller } = setup(true, false);
		host.move(-1);
		expect(host.index).toBe(1);
		expect(host.entries).toHaveLength(2);
		expect(host.history.pushState).not.toHaveBeenCalled();
		expect(callbacks.canLeave).toHaveBeenCalledTimes(1);
		expect(callbacks.restore).not.toHaveBeenCalled();
		controller.dispose();
	});
	it("uses native entry positions to undo an uncancelable traversal to an unmarked entry", () => {
		const { host, callbacks, controller } = setup(true, false);
		host.move(-1, false);
		expect(host.index).toBe(1);
		expect(host.history.go).toHaveBeenCalledWith(1);
		expect(host.history.pushState).not.toHaveBeenCalled();
		expect(callbacks.restore).not.toHaveBeenCalled();
		controller.dispose();
	});
	it("restores a known workspace entry on legacy browsers without another prompt", () => {
		const { host, callbacks, controller } = setup(false, false);
		controller.write(
			parseWorkspaceView(new URLSearchParams("section=deliveries")),
		);
		host.move(-1);
		expect(host.index).toBe(2);
		expect(host.entries).toHaveLength(3);
		expect(host.history.pushState).toHaveBeenCalledTimes(1);
		expect(callbacks.canLeave).toHaveBeenCalledTimes(1);
		expect(callbacks.restore).not.toHaveBeenCalled();
		controller.dispose();
	});
	it("checks an allowed native traversal once and restores its actual view", () => {
		const { host, callbacks, controller } = setup(true, true);
		controller.write(
			parseWorkspaceView(new URLSearchParams("section=deliveries")),
		);
		host.move(-1);
		expect(callbacks.canLeave).toHaveBeenCalledTimes(1);
		expect(callbacks.restore).toHaveBeenCalledWith(
			expect.objectContaining({ section: "files" }),
		);
		controller.dispose();
	});
	it("lets an allowed external route reach the framework without parsing it as a workspace", () => {
		const { host, callbacks, controller } = setup(true, true),
			framework = vi.fn();
		host.addEventListener("popstate", framework);
		host.move(-1);
		expect(host.location.href).toBe(`${origin}/projects`);
		expect(framework).toHaveBeenCalledOnce();
		expect(callbacks.restore).not.toHaveBeenCalled();
		expect(callbacks.travel).toHaveBeenCalledOnce();
		controller.dispose();
	});
	it("removes both native and legacy listeners when the workspace leaves", () => {
		const { host, callbacks, controller } = setup(true, false);
		controller.dispose();
		host.move(-1);
		expect(host.index).toBe(0);
		expect(callbacks.canLeave).not.toHaveBeenCalled();
	});
	it("distinguishes a retained tab session from changing the selected annotation or filters", () => {
		const a = parseWorkspaceView(
			new URLSearchParams(
				"section=files&file=00000000-0000-4000-8000-000000000001",
			),
		);
		expect(sameWorkspaceContext(a, { ...a, section: "deliveries" })).toBe(true);
		expect(sameWorkspaceContext(a, { ...a, annotationId: "other" })).toBe(
			false,
		);
		expect(sameWorkspaceContext(a, { ...a, type: "pdf" })).toBe(false);
	});
});
