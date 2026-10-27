export type HistoryPosition = { chain: string; position: number };
export function historyPosition(state: unknown): HistoryPosition | null {
	if (!state || typeof state !== "object" || !("pmHistory" in state)) return null;
	const value = state.pmHistory as Partial<HistoryPosition> | null;
	return value && typeof value.chain === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value.chain) &&
		typeof value.position === "number" && Number.isSafeInteger(value.position) && value.position >= 0
		? { chain: value.chain, position: value.position } : null;
}
const trackers = new WeakMap<Window, { users: number; release: () => void }>();
/** Stamp same-document application entries from the root, including the list before the workspace.
 * Contains only an opaque chain and position. Preserve Next's state; never insert sentinel entries. */
export function retainHistoryPositions(host: Window) {
	let tracker = trackers.get(host);
	if (!tracker) {
		const history = host.history, push = history.pushState, replace = history.replaceState;
		let active = true;
		const newChain = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		let current = historyPosition(history.state) ?? { chain: newChain(), position: 0 };
		const record = (data: unknown) => data === null || typeof data === "object" && !Array.isArray(data);
		if (record(history.state)) replace.call(history, { ...history.state, pmHistory: current }, "", host.location.href);
		const moved = (event: PopStateEvent) => { current = historyPosition(event.state) ?? { chain: newChain(), position: 0 }; };
		const pushed: History["pushState"] = (data, unused, url) => {
			if (!active || !record(data)) return push.call(history, data, unused, url);
			const next = { chain: current.chain, position: current.position + 1 };
			const result = push.call(history, { ...data, pmHistory: next }, unused, url);
			current = next;
			return result;
		};
		const replaced: History["replaceState"] = (data, unused, url) => {
			return replace.call(history, active && record(data) ? { ...data, pmHistory: current } : data, unused, url);
		};
		history.pushState = pushed;
		history.replaceState = replaced;
		host.addEventListener("popstate", moved, { capture: true });
		tracker = { users: 0, release: () => {
			active = false;
			host.removeEventListener("popstate", moved, { capture: true });
			// The framework may have installed its own wrapper since ours; do not overwrite it.
			if (history.pushState === pushed) history.pushState = push;
			if (history.replaceState === replaced) history.replaceState = replace;
		} };
		trackers.set(host, tracker);
	}
	tracker.users++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--tracker.users === 0) { tracker.release(); trackers.delete(host); }
	};
}
