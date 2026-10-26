"use client";
import {
	useEffect,
	useId,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { motionDuration } from "./ui-motion";
import { lockBodyScroll } from "./body-scroll-lock";
import { revealFocusedDialogControl } from "./dialog-viewport";

const query = "(max-width: 700px)";
function subscribe(change: () => void) {
	const media = window.matchMedia(query);
	media.addEventListener("change", change);
	return () => media.removeEventListener("change", change);
}
const snapshot = () => window.matchMedia(query).matches;
const serverSnapshot = () => false;

export function WorkspaceContextDialog({
	active,
	mobileOpen,
	title,
	onClose,
	targetRef,
	minimalHeader = false,
}: {
	active: boolean;
	mobileOpen: boolean;
	title: string;
	onClose: () => void;
	targetRef: (element: HTMLDivElement | null) => void;
	minimalHeader?: boolean;
}) {
	const mobile = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
	const dialog = useRef<HTMLDialogElement>(null);
	const [phase, setPhase] = useState("closed");
	const titleId = useId();
	const shouldOpen = active && (!mobile || mobileOpen);
	useEffect(() => {
		const element = dialog.current;
		if (!mobile) {
			element?.style.removeProperty("--context-visible-height");
			element?.style.removeProperty("--context-visible-top");
			return;
		}
		const viewport = window.visualViewport;
		let frame = 0;
		const sync = () => {
			if (!shouldOpen) return;
			element?.style.setProperty(
				"--context-visible-height",
				`${viewport?.height ?? window.innerHeight}px`,
			);
			element?.style.setProperty(
				"--context-visible-top",
				`${viewport?.offsetTop ?? 0}px`,
			);
			revealFocusedDialogControl(element);
		};
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(sync);
		};
		sync();
		viewport?.addEventListener("resize", schedule);
		viewport?.addEventListener("scroll", schedule);
		element?.addEventListener("focusin", schedule);
		return () => {
			cancelAnimationFrame(frame);
			viewport?.removeEventListener("resize", schedule);
			viewport?.removeEventListener("scroll", schedule);
			element?.removeEventListener("focusin", schedule);
		};
	}, [mobile, shouldOpen]);
	useEffect(() => {
		const element = dialog.current;
		if (!element) return;
		if (shouldOpen) {
			setPhase("open");
			if (element.open && element.matches(":modal") !== mobile) element.close();
			if (!element.open) {
				if (mobile) element.showModal();
				else {
					const focused = document.activeElement;
					element.show();
					if (focused instanceof HTMLElement && focused.isConnected)
						focused.focus({ preventScroll: true });
				}
			}
			return;
		}
		if (!element.open) return;
		setPhase("closing");
		const timer = setTimeout(() => {
			element.close();
			setPhase("closed");
		}, motionDuration("exit"));
		return () => clearTimeout(timer);
	}, [mobile, shouldOpen]);
	useEffect(() => {
		if (!mobile || (!shouldOpen && phase !== "closing")) return;
		return lockBodyScroll();
	}, [mobile, shouldOpen, phase]);
	return (
		<dialog
			ref={dialog}
			className="workspace-context-dialog"
			data-phase={phase}
			data-minimal-header={minimalHeader}
			aria-labelledby={titleId}
			inert={phase === "closing"}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			onPointerDown={(event) => {
				if (event.target !== event.currentTarget || !mobile) return;
				const bounds = event.currentTarget.getBoundingClientRect();
				if (
					event.clientX < bounds.left ||
					event.clientX > bounds.right ||
					event.clientY < bounds.top ||
					event.clientY > bounds.bottom
				)
					onClose();
			}}
		>
			<header className="workspace-context-header">
				<h2 id={titleId}>{title}</h2>
				<button type="button" onClick={onClose} aria-label="关闭标注信息">
					<span aria-hidden="true">×</span>
				</button>
			</header>
			<div ref={targetRef} className="workspace-context-content" />
		</dialog>
	);
}
