/** Scroll only the dialog, keeping the page behind it in place when the keyboard shrinks the viewport. */
export function revealFocusedDialogControl(container: HTMLElement | null) {
	const focused = document.activeElement;
	if (
		!container?.isConnected ||
		!(focused instanceof HTMLElement) ||
		!container.contains(focused) ||
		!focused.matches("input,textarea,select")
	)
		return;
	const frame = container.getBoundingClientRect(),
		field = focused.getBoundingClientRect();
	const top = frame.top + 16,
		bottom = frame.bottom - 16;
	if (field.top < top) container.scrollTop -= top - field.top;
	else if (field.bottom > bottom) container.scrollTop += field.bottom - bottom;
}
