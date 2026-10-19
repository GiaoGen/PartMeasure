"use client";
import {
	useEffect,
	useId,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

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
}: {
	active: boolean;
	mobileOpen: boolean;
	title: string;
	onClose: () => void;
	targetRef: (element: HTMLDivElement | null) => void;
}) {
	const mobile = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
	const dialog = useRef<HTMLDialogElement>(null);
	const [phase, setPhase] = useState("open");
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
		};
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(sync);
		};
		sync();
		viewport?.addEventListener("resize", schedule);
		viewport?.addEventListener("scroll", schedule);
		return () => {
			cancelAnimationFrame(frame);
			viewport?.removeEventListener("resize", schedule);
			viewport?.removeEventListener("scroll", schedule);
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
				else element.show();
			}
			return;
		}
		if (!element.open) return;
		setPhase("closing");
		const timer = setTimeout(
			() => element.close(),
			window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180,
		);
		return () => clearTimeout(timer);
	}, [mobile, shouldOpen]);
	useEffect(() => {
		if (!mobile || !shouldOpen) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previous;
		};
	}, [mobile, shouldOpen]);
	return (
		<dialog
			ref={dialog}
			className="workspace-context-dialog"
			data-phase={phase}
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
