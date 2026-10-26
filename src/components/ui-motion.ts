/** Shared UI timing only; never animates image pixels, geometry or layout dimensions. */
export const uiMotion = { enter: 160, exit: 120 } as const;
export function motionDuration(phase: keyof typeof uiMotion) {
	return typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
		? 0
		: uiMotion[phase];
}
