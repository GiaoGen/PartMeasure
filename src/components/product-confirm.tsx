"use client";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { motionDuration } from "./ui-motion";
import { onApiSessionCleared } from "./api";
import { useActionLifetime } from "./use-action-lifetime";
import { lockBodyScroll } from "./body-scroll-lock";

type Confirmation = {
	title: string;
	description: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
	signal?: AbortSignal;
};
type Confirm = (request: Confirmation) => Promise<boolean>;
const ConfirmContext = createContext<Confirm>(
	async (request) =>
		!request.signal?.aborted &&
		window.confirm(`${request.title}\n${request.description}`),
);
export function useProductConfirm(scope = "") {
	const confirm = useContext(ConfirmContext);
	const lifetime = useActionLifetime(scope);
	return useCallback<Confirm>(
		(request) => {
			const signal = request.signal
				? AbortSignal.any([request.signal, lifetime.signal])
				: lifetime.signal;
			return confirm({ ...request, signal }).then(
				(accepted) => accepted && !signal.aborted,
			);
		},
		[confirm, lifetime],
	);
}

/** Only the user's explicit acceptance resolves true. Unmounting cancels the pending action. */
export function ProductConfirmProvider({ children }: { children: ReactNode }) {
	const [request, setRequest] = useState<Confirmation | null>(null);
	const [closing, setClosing] = useState(false);
	const pending = useRef<((accepted: boolean) => void) | null>(null);
	const closingRef = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const dialog = useRef<HTMLDialogElement>(null);
	const title = useId(),
		description = useId();
	const confirm = useCallback<Confirm>((next) => {
		if (pending.current || next.signal?.aborted) return Promise.resolve(false);
		return new Promise((resolve) => {
			const cancel = () => {
				if (timer.current) clearTimeout(timer.current);
				const complete = pending.current;
				pending.current = null;
				closingRef.current = false;
				dialog.current?.close();
				setClosing(false);
				setRequest(null);
				complete?.(false);
			};
			next.signal?.addEventListener("abort", cancel, { once: true });
			pending.current = (accepted) => {
				next.signal?.removeEventListener("abort", cancel);
				resolve(accepted);
			};
			setRequest(next);
		});
	}, []);
	useEffect(() => {
		if (request && !dialog.current?.open) dialog.current?.showModal();
	}, [request]);
	useEffect(() => {
		if (!request) return;
		return lockBodyScroll();
	}, [request]);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
			pending.current?.(false);
			pending.current = null;
		},
		[],
	);
	useEffect(
		() =>
			onApiSessionCleared(() => {
				if (timer.current) clearTimeout(timer.current);
				const resolve = pending.current;
				pending.current = null;
				closingRef.current = false;
				dialog.current?.close();
				setClosing(false);
				setRequest(null);
				resolve?.(false);
			}),
		[],
	);
	function finish(accepted: boolean) {
		if (closingRef.current) return;
		closingRef.current = true;
		setClosing(true);
		timer.current = setTimeout(() => {
			dialog.current?.close();
			const resolve = pending.current;
			pending.current = null;
			closingRef.current = false;
			setClosing(false);
			setRequest(null);
			resolve?.(accepted);
		}, motionDuration("exit"));
	}
	return (
		<ConfirmContext.Provider value={confirm}>
			{children}
			<dialog
				ref={dialog}
				className="pm-confirm"
				data-phase={closing ? "closing" : "open"}
				aria-labelledby={title}
				aria-describedby={description}
				onCancel={(event) => {
					event.preventDefault();
					finish(false);
				}}
			>
				{request ? (
					<div inert={closing}>
						<h2 id={title}>{request.title}</h2>
						<p id={description} className="preserve-lines">
							{request.description}
						</p>
						<div className="pm-confirm-actions">
							<button type="button" onClick={() => finish(false)}>
								{request.cancelLabel ?? "取消"}
							</button>
							<button
								type="button"
								className={request.danger ? "danger" : "primary"}
								onClick={() => finish(true)}
							>
								{request.confirmLabel ?? "确认"}
							</button>
						</div>
					</div>
				) : null}
			</dialog>
		</ConfirmContext.Provider>
	);
}
