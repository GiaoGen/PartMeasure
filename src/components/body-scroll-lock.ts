const locks = new WeakMap<Document, { count: number; previous: string }>();

/** Nested dialogs release independently; the last close restores the original style exactly once. */
export function lockBodyScroll(target: Document = document) {
	let state = locks.get(target);
	if (!state) {
		state = { count: 0, previous: target.body.style.overflow };
		locks.set(target, state);
	}
	state.count++;
	target.body.style.overflow = "hidden";
	let released = false;
	return () => {
		if (released) return;
		released = true;
		state.count--;
		if (!state.count) {
			target.body.style.overflow = state.previous;
			locks.delete(target);
		}
	};
}
