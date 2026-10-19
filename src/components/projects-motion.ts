"use client";
import { useEffect, useRef } from "react";
import type { PointerEvent, SyntheticEvent } from "react";

export function prefersReducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Keep the native modal/focus trap alive until its exit animation has finished. */
export function useProjectDialog() {
	const ref = useRef<HTMLDialogElement>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const closing = useRef(false);
	const continuation = useRef<(() => void) | undefined>(undefined);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
			continuation.current = undefined;
		},
		[],
	);
	function open() {
		const dialog = ref.current;
		if (!dialog || closing.current) return;
		dialog.dataset.phase = "enter";
		if (!dialog.open) dialog.showModal();
	}
	function close(after?: () => void) {
		const dialog = ref.current;
		if (closing.current) return;
		if (!dialog?.open) {
			after?.();
			return;
		}
		closing.current = true;
		continuation.current = after;
		const appearance = getComputedStyle(dialog);
		dialog.style.setProperty("--projects-exit-from", appearance.transform);
		dialog.style.setProperty("--projects-exit-opacity", appearance.opacity);
		dialog.dataset.phase = "exit";
		timer.current = setTimeout(
			() => {
				dialog.close();
				dialog.dataset.phase = "idle";
				closing.current = false;
				timer.current = null;
				const next = continuation.current;
				continuation.current = undefined;
				next?.();
			},
			prefersReducedMotion() ? 0 : 220,
		);
	}
	function cancel(event: SyntheticEvent, blocked = false) {
		event.preventDefault();
		if (!blocked) close();
	}
	function backdrop(event: PointerEvent<HTMLDialogElement>, blocked = false) {
		if (blocked || event.target !== event.currentTarget) return;
		const bounds = event.currentTarget.getBoundingClientRect();
		if (
			event.clientX < bounds.left ||
			event.clientX > bounds.right ||
			event.clientY < bounds.top ||
			event.clientY > bounds.bottom
		)
			close();
	}
	return { ref, open, close, cancel, backdrop };
}
