"use client";
import { useEffect, useRef } from "react";
import type { PointerEvent, SyntheticEvent } from "react";
import { motionDuration } from "./ui-motion";
import { lockBodyScroll } from "./body-scroll-lock";

export function prefersReducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Keep the native modal/focus trap alive until its exit animation has finished. */
export function useProjectDialog() {
	const ref = useRef<HTMLDialogElement>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const closing = useRef(false);
	const continuation = useRef<(() => void) | undefined>(undefined);
	const unlock = useRef<(() => void) | undefined>(undefined);
	useEffect(() => {
		const dialog = ref.current;
		const closed = () => {
			if (dialog?.open) return;
			unlock.current?.();
			unlock.current = undefined;
			if (timer.current) clearTimeout(timer.current);
			timer.current = null;
			closing.current = false;
			continuation.current = undefined;
		};
		dialog?.addEventListener("close", closed);
		return () => {
			dialog?.removeEventListener("close", closed);
			unlock.current?.();
			unlock.current = undefined;
			if (timer.current) clearTimeout(timer.current);
			timer.current = null;
			closing.current = false;
			continuation.current = undefined;
		};
	}, []);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
			continuation.current = undefined;
		},
		[],
	);
	function open() {
		const dialog = ref.current;
		if (!dialog) return;
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		closing.current = false;
		continuation.current = undefined;
		dialog.dataset.phase = "enter";
		if (!dialog.open) {
			dialog.showModal();
			unlock.current ??= lockBodyScroll();
		}
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
		dialog.dataset.phase = "exit";
		timer.current = setTimeout(() => {
			dialog.close();
			unlock.current?.();
			unlock.current = undefined;
			dialog.dataset.phase = "idle";
			closing.current = false;
			timer.current = null;
			const next = continuation.current;
			continuation.current = undefined;
			next?.();
		}, motionDuration("exit"));
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
