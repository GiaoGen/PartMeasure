"use client";
import { useEffect, useState, type ReactNode } from "react";
import { motionDuration } from "./ui-motion";

/** Retain the current content through exit; no measured height or per-frame layout work. */
export function DisclosureRegion({
	open,
	id,
	children,
	busy = false,
}: {
	open: boolean;
	id: string;
	children: ReactNode;
	busy?: boolean;
}) {
	const [phase, setPhase] = useState(open ? "open" : "closed");
	useEffect(() => {
		if (open) {
			setPhase("open");
			return;
		}
		setPhase((old) => (old === "closed" ? old : "closing"));
		const timer = setTimeout(() => setPhase("closed"), motionDuration("exit"));
		return () => clearTimeout(timer);
	}, [open]);
	return (
		<div
			id={id}
			className="pm-disclosure-region"
			hidden={phase === "closed"}
			data-phase={phase}
			aria-hidden={!open}
			aria-busy={busy}
			inert={!open}
		>
			{phase !== "closed" ? children : null}
		</div>
	);
}
