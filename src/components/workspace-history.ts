import {
	historyMarker,
	parseWorkspaceView,
	workspaceHref,
	type WorkspaceView,
} from "./workspace-navigation";

type NavigationSurface = {
	currentEntry?: { index: number };
	addEventListener(type: string, listener: EventListener): void;
	removeEventListener(type: string, listener: EventListener): void;
};
type TraverseEvent = Event & {
	navigationType?: string;
	destination?: { url: string; sameDocument: boolean };
};
export type WorkspaceHistoryCallbacks = {
	canLeave: (target: URL) => boolean;
	restore: (view: WorkspaceView) => void;
	travel?: () => void;
};

/** No records or drafts in history. Native traverse cancellation preserves the forward branch when available. */
export class WorkspaceHistory {
	private current: {
		href: string;
		index: number;
		state: unknown;
		position: number | null;
	};
	private recovering = false;
	private approved: string | null = null;
	private navigation: NavigationSurface | undefined;
	constructor(
		private host: Window,
		private scope: string,
		private guest: boolean,
		private callbacks: () => WorkspaceHistoryCallbacks,
	) {
		this.navigation = (
			host as Window & { navigation?: NavigationSurface }
		).navigation;
		const index = historyMarker(host.history.state, scope)?.index ?? 0;
		const state = { ...host.history.state, pmWorkspace: { scope, index } };
		host.history.replaceState(state, "", host.location.href);
		this.current = {
			href: host.location.href,
			index,
			state,
			position: this.position(),
		};
		host.addEventListener("popstate", this.pop, { capture: true });
		this.navigation?.addEventListener("navigate", this.traverse);
		this.navigation?.addEventListener("navigateerror", this.clearApproval);
		this.navigation?.addEventListener("navigatesuccess", this.clearApproval);
	}
	private position() {
		const value = this.navigation?.currentEntry?.index;
		return typeof value === "number" && Number.isSafeInteger(value)
			? value
			: null;
	}
	private clearApproval: EventListener = () => {
		this.approved = null;
	};
	private traverse: EventListener = (raw) => {
		const event = raw as TraverseEvent;
		if (
			this.recovering ||
			event.navigationType !== "traverse" ||
			!event.cancelable ||
			!event.destination?.sameDocument
		)
			return;
		const target = new URL(event.destination.url, this.current.href);
		if (!this.callbacks().canLeave(target)) {
			event.preventDefault();
			this.approved = null;
			return;
		}
		this.approved = target.href;
		queueMicrotask(() => {
			if (event.defaultPrevented) this.approved = null;
		});
	};
	private pop = (event: PopStateEvent) => {
		const target = new URL(this.host.location.href),
			saved = this.current;
		const marker = historyMarker(event.state, this.scope),
			position = this.position();
		if (
			this.recovering &&
			target.href === saved.href &&
			((position !== null && position === saved.position) ||
				marker?.index === saved.index)
		) {
			this.recovering = false;
			event.stopImmediatePropagation();
			return;
		}
		const allowed =
			this.approved === target.href || this.callbacks().canLeave(target);
		this.approved = null;
		if (!allowed) {
			event.stopImmediatePropagation();
			const delta =
				saved.position !== null && position !== null
					? saved.position - position
					: marker
						? saved.index - marker.index
						: 0;
			if (delta) {
				this.recovering = true;
				this.host.history.go(delta);
			} else this.host.history.pushState(saved.state, "", saved.href); // Legacy unknown entries cannot expose their direction.
			return;
		}
		this.callbacks().travel?.();
		const origin = new URL(saved.href);
		if (
			target.pathname !== origin.pathname ||
			(this.guest &&
				target.searchParams.get("project") !==
					origin.searchParams.get("project"))
		)
			return;
		event.stopImmediatePropagation();
		const index = marker?.index ?? saved.index - 1;
		const state = { pmWorkspace: { scope: this.scope, index } };
		this.current = { href: target.href, index, state, position };
		this.host.history.replaceState(state, "", target.href);
		this.callbacks().restore(parseWorkspaceView(target.searchParams));
	};
	sync(search: string) {
		const target = new URL(this.host.location.href);
		if (target.href === this.current.href) return;
		if (!this.callbacks().canLeave(target)) {
			this.host.history.replaceState(this.current.state, "", this.current.href);
			return;
		}
		this.callbacks().travel?.();
		this.current = {
			href: target.href,
			index: historyMarker(this.host.history.state, this.scope)?.index ?? 0,
			state: this.host.history.state,
			position: this.position(),
		};
		this.callbacks().restore(parseWorkspaceView(new URLSearchParams(search)));
	}
	write(view: WorkspaceView, replace = false) {
		const url = new URL(this.host.location.href),
			href = workspaceHref(url, view, this.guest);
		if (`${url.pathname}${url.search}` === href) return;
		const index = this.current.index + (replace ? 0 : 1),
			state = { pmWorkspace: { scope: this.scope, index } };
		if (replace) this.host.history.replaceState(state, "", href);
		else this.host.history.pushState(state, "", href);
		this.current = {
			href: new URL(href, url.origin).href,
			index,
			state,
			position: this.position(),
		};
	}
	dispose() {
		this.host.removeEventListener("popstate", this.pop, { capture: true });
		this.navigation?.removeEventListener("navigate", this.traverse);
		this.navigation?.removeEventListener("navigateerror", this.clearApproval);
		this.navigation?.removeEventListener("navigatesuccess", this.clearApproval);
	}
}
