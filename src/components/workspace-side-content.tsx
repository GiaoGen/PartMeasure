"use client";
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const WorkspaceSideTarget = createContext<HTMLElement | null>(null);

// A single editor owns both the canvas and its contextual panel. Moving only
// the DOM keeps the annotation session and unsaved form state together.
export function WorkspaceSideContent({ children }: { children: ReactNode }) {
	const target = useContext(WorkspaceSideTarget);
	return target ? createPortal(children, target) : children;
}
