"use client";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import {
	acceptChanges,
	mergeProjectUpdates,
	type ProjectChanges,
	type ProjectUpdate,
} from "@/lib/project-events";
import { api, ApiError, clearApiSession, invalidateProjectQueries, onApiSessionCleared } from "./api";

type Listener = (updates: ProjectUpdate[]) => void;
const Live = createContext<(listener: Listener) => () => void>(() => () => {});
export function ProjectLiveProvider({
	base,
	cursor: initial,
	onInvalid,
	children,
}: {
	base: string;
	cursor?: string | undefined;
	onInvalid: () => void;
	children: ReactNode;
}) {
	const listeners = useRef(new Set<Listener>());
	const invalid = useRef(onInvalid);
	invalid.current = onInvalid;
	const [state, setState] = useState("连接更新中…");
	const subscribe = useCallback((listener: Listener) => {
		listeners.current.add(listener);
		return () => {
			listeners.current.delete(listener);
		};
	}, []);
	useEffect(() => {
		let cursor = initial ?? null,
			sequence: string | null = null;
		// Cursor is context-bound by the server. Only its sequence is needed for dedupe.
		try {
			if (cursor) sequence = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/"))).n;
		} catch {
			cursor = null;
		}
		let source: EventSource | null = null,
			closed = false,
			online = false,
			failures = 0,
			fallbackBusy = false;
		let retry: ReturnType<typeof setTimeout> | undefined;
		let fallback: ReturnType<typeof setInterval> | undefined;
		let notifyTimer: ReturnType<typeof setTimeout> | undefined;
		let pending: ProjectUpdate[] = [];
		function flush() {
			clearTimeout(notifyTimer);
			notifyTimer = undefined;
			const updates = pending;
			pending = [];
			if (closed || !updates.length) return;
			invalidateProjectQueries(base,updates);
			for (const listener of listeners.current) listener(updates);
		}
		const stop = () => {
			source?.close();
			source = null;
			online = false;
			clearTimeout(retry);
			clearInterval(fallback);
			retry = undefined;
			fallback = undefined;
			flush();
		};
		const unavailable = () => {
			if (closed) return;
			closed = true;
			stop();
			invalid.current();
		};
		const receive = (batch: ProjectChanges) => {
			if (closed) return;
			const accepted = acceptChanges(sequence, batch);
			if (accepted.sequence !== batch.sequence) return;
			sequence = accepted.sequence;
			cursor = batch.cursor;
			if (accepted.updates.length) {
				pending = mergeProjectUpdates(pending, accepted.updates);
				notifyTimer ??= setTimeout(flush, 150);
			}
		};
		const compensate = async () => {
			if (closed || online || document.hidden || fallbackBusy) return;
			fallbackBusy = true;
			try {
				receive(
					await api<ProjectChanges>(
						`${base}/changes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
					),
				);
			} catch (e) {
				if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
					clearApiSession();
					unavailable();
				}
				if (e instanceof ApiError && e.status === 422) {
					cursor = null;
					sequence = null;
				}
			} finally {
				fallbackBusy = false;
			}
		};
		const connect = () => {
			if (closed || document.hidden) return;
			source?.close();
			online = false;
			source = new EventSource(
				`${base}/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
			);
			source.addEventListener("changes", (event) => {
				try {
					receive(JSON.parse((event as MessageEvent).data));
				} catch {
					source?.close();
					disconnected();
					return;
				}
				online = true;
				failures = 0;
				clearInterval(fallback);
				fallback = undefined;
				setState("实时更新已连接");
			});
			source.addEventListener("unavailable", () => {
				clearApiSession();
				unavailable();
			});
			source.addEventListener("rotate", () => {
				source?.close();
				retry = setTimeout(connect, 250);
			});
			source.onerror = disconnected;
		};
		function disconnected() {
			source?.close();
			source = null;
			online = false;
			if (closed || document.hidden) return;
			setState("更新连接中断，正在重连；输入仍保留。");
			clearTimeout(retry);
			retry = setTimeout(
				connect,
				Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)) + Math.random() * 500,
			);
			fallback ??= setInterval(() => void compensate(), 30000);
		}
		const visible = () => {
			stop();
			if (!document.hidden) {
				connect();
			}
		};
		const off = onApiSessionCleared(unavailable);
		const pageShow = (event: PageTransitionEvent) => { if (event.persisted) visible(); };
		document.addEventListener("visibilitychange", visible);
		window.addEventListener("online", visible);
		window.addEventListener("pagehide", stop);
		window.addEventListener("pageshow", pageShow);
		connect();
		return () => {
			closed = true;
			stop();
			off();
			document.removeEventListener("visibilitychange", visible);
			window.removeEventListener("online", visible);
			window.removeEventListener("pagehide", stop);
			window.removeEventListener("pageshow", pageShow);
		};
	}, [base, initial]);
	return (
		<Live value={subscribe}>
			<p className="muted" role="status">
				{state}
			</p>
			{children}
		</Live>
	);
}

/** One subscription per workspace; batch notifications never replace a component's draft. */
export function useProjectUpdates(listener: Listener) {
	const subscribe = useContext(Live),
		current = useRef(listener);
	current.current = listener;
	useEffect(() => subscribe((updates) => current.current(updates)), [subscribe]);
}
