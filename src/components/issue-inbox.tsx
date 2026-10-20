"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { type IssueSummary, stateLabel } from "@/lib/issues";
import { api, ApiError } from "./api";
import { IssueDetail } from "./issue-detail";
import { useProjectDialog } from "./projects-motion";
import { WorkspaceSideTarget } from "./workspace-side-content";
import { WorkspaceIcon } from "./workspace-ui";
import { ownTask, taskInboxState } from "./task-inbox-state";
import "./issue-inbox.css";

export function IssueInbox({
	base,
	guest,
	refreshKey,
	onInvalid,
	onUpdated,
	onDirty,
	onOpenAnnotation,
}: {
	base: string;
	guest: boolean;
	refreshKey: number;
	onInvalid: () => void;
	onUpdated: () => void;
	onDirty: (dirty: boolean) => void;
	onOpenAnnotation?: (fileId: string, annotationId: string) => boolean;
}) {
	const popup = useProjectDialog();
	const titleId = useId();
	const [opened, setOpened] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);
	const [items, setItems] = useState<IssueSummary[]>([]);
	const [counts, setCounts] = useState<Record<string, number>>({});
	const [cursor, setCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [loaded, setLoaded] = useState(false);
	const [error, setError] = useState("");
	const dirty = useRef(false);
	const callbacks = useRef({ onInvalid, onDirty });
	callbacks.current = { onInvalid, onDirty };
	const request = useRef(false);
	const generation = useRef(0);
	const queued = useRef(false);
	const reload = useRef<() => void>(() => {});
	const handleDirty = useCallback((value: boolean) => {
		dirty.current = value;
		callbacks.current.onDirty(value);
	}, []);
	const load = useCallback(
		async (next: string | null = null) => {
			if (request.current) {
				queued.current = true;
				return;
			}
			request.current = true;
			const run = generation.current;
			setLoading(true);
			try {
				const data = await api<{
					items: IssueSummary[];
					counts: Record<string, number>;
					nextCursor: string | null;
				}>(
					`${base}/issues${next ? `?cursor=${encodeURIComponent(next)}` : ""}`,
					"GET", undefined, { cacheMs: 1000 },
				);
				if (run !== generation.current) return;
				setItems((old) =>
					next
						? [
								...old,
								...data.items.filter(
									(item) => !old.some((previous) => previous.id === item.id),
								),
							]
						: data.items,
				);
				setCounts(data.counts);
				setCursor(data.nextCursor);
				setError("");
				setLoaded(true);
			} catch (e) {
				if (run !== generation.current) return;
				if (e instanceof ApiError && e.status === 401)
					callbacks.current.onInvalid();
				setError(e instanceof Error ? e.message : "无法读取待办。");
			} finally {
				if (run === generation.current) {
					request.current = false;
					setLoading(false);
					if (queued.current) {
						queued.current = false;
						reload.current();
					}
				}
			}
		},
		[base],
	);
	reload.current = () => {
		void load();
	};
	useEffect(() => {
		void refreshKey;
		void load();
	}, [load, refreshKey]);

	useEffect(
		() => () => {
			generation.current++;
			request.current = false;
			queued.current = false;
			callbacks.current.onDirty(false);
		},
		[],
	);
	useEffect(() => {
		if (!opened) return;
		const element = popup.ref.current;
		const viewport = window.visualViewport;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		let frame = 0;
		const update = () => {
			element?.style.setProperty(
				"--task-visible-height",
				`${viewport?.height ?? window.innerHeight}px`,
			);
			element?.style.setProperty(
				"--task-visible-top",
				`${viewport?.offsetTop ?? 0}px`,
			);
		};
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(update);
		};
		update();
		viewport?.addEventListener("resize", schedule);
		viewport?.addEventListener("scroll", schedule);
		return () => {
			cancelAnimationFrame(frame);
			viewport?.removeEventListener("resize", schedule);
			viewport?.removeEventListener("scroll", schedule);
			document.body.style.overflow = previousOverflow;
		};
	}, [opened, popup.ref]);
	useEffect(() => {
		if (opened)
			popup.ref.current
				?.querySelector<HTMLButtonElement>(
					selected
						? '.task-inbox-heading button[aria-label="关闭待办"]'
						: ".task-inbox-heading button:not(:disabled)",
				)
				?.focus();
	}, [selected, opened, popup.ref]);
	const backToList = () => {
		if (
			dirty.current &&
			!window.confirm(
				"有未保存或未确认的提交，仍要返回事项列表吗？已发出的请求可能仍完成。",
			)
		)
			return;
		setSelected(null);
		void load();
	};
	function close() {
		// Keep detail mounted: closing is not discarding its reply/review form.
		popup.close(() => setOpened(false));
	}
	const badge = taskInboxState(counts, guest, !!error || !loaded);
	const pending = items.filter((item) => item.state !== "confirmed");
	const mine = pending.filter((item) => ownTask(item, guest));
	const waiting = pending.filter((item) => !ownTask(item, guest));
	function group(label: string, rows: IssueSummary[], count: number) {
		if (!rows.length) return null;
		return (
			<section className="task-inbox-group" aria-label={label}>
				<h3>
					{label} · {count}
				</h3>
				<ul>
					{rows.map((item) => (
						<li key={item.id}>
							<button type="button" onClick={() => { if (item.kind === "measurement" && item.annotationRef && onOpenAnnotation?.(item.fileId, item.annotationRef.id)) close(); else setSelected(item.id); }}>
								<span>
									<strong>{item.title}</strong>
									<small>
										{item.kind === "measurement" ? "标注补充" : "文件问题"}
									</small>
								</span>
								<small>{stateLabel[item.state]}</small>
							</button>
						</li>
					))}
				</ul>
			</section>
		);
	}
	return (
		<div className="task-inbox">
			<button
				type="button"
				className="task-inbox-fab"
				data-tone={badge.tone}
				aria-label={loading && !loaded ? "正在读取待办" : badge.label}
				title={loading && !loaded ? "正在读取待办" : badge.label}
				aria-haspopup="dialog"
				aria-expanded={opened}
				onClick={() => {
					setOpened(true);
					popup.open();
					if (!selected) void load();
				}}
			>
				<WorkspaceIcon kind="bell" />
				{error ? (
					<span className="task-inbox-badge" aria-hidden="true">
						!
					</span>
				) : badge.own > 0 ? (
					<span className="task-inbox-badge" aria-hidden="true">
						{badge.own > 99 ? "99+" : badge.own}
					</span>
				) : null}
			</button>
			<span className="task-inbox-announcement" role="status">
				{loaded ? badge.label : "正在读取待办"}
			</span>
			<dialog
				ref={popup.ref}
				className="task-inbox-dialog"
				aria-labelledby={titleId}
				onCancel={(event) => {
					event.preventDefault();
					close();
				}}
				onPointerDown={(event) => {
					if (event.target !== event.currentTarget) return;
					const rect = event.currentTarget.getBoundingClientRect();
					if (
						event.clientX < rect.left ||
						event.clientX > rect.right ||
						event.clientY < rect.top ||
						event.clientY > rect.bottom
					)
						close();
				}}
			>
				<header className="task-inbox-heading">
					<h2 id={titleId}>待处理事项</h2>
					<div>

						<button type="button" onClick={close} aria-label="关闭待办">
							<span aria-hidden="true">×</span>
						</button>
					</div>
				</header>
				<div className="task-inbox-list" hidden={!!selected}>
					{loading ? <p role="status">读取待办…</p> : null}
					{error ? (
						<p className="error" role="alert">
							{error}
							<button type="button" onClick={() => void load()}>
								重试
							</button>
						</p>
					) : null}
					{!loading && !error && loaded && badge.own + badge.waiting === 0 ? (
						<div className="task-inbox-empty">
							<WorkspaceIcon kind="check" />
							<p>没有待处理事项</p>
						</div>
					) : null}
					{group("待我处理", mine, badge.own)}
					{group("等待对方", waiting, badge.waiting)}
					{!loading &&
					!error &&
					loaded &&
					badge.own + badge.waiting > 0 &&
					!pending.length ? (
						<p>待办尚未载入，请加载更多。</p>
					) : null}
					{cursor ? (
						<button
							type="button"
							disabled={loading}
							onClick={() => void load(cursor)}
						>
							加载更多事项
						</button>
					) : null}
				</div>
				<WorkspaceSideTarget value={null}>
					{selected ? (
						<IssueDetail
							key={selected}
							base={base}
							id={selected}
							guest={guest}
							panelOnly
							backLabel="全部事项"
							onInvalid={onInvalid}
							onUpdated={onUpdated}
							onDirty={handleDirty}
							onBack={backToList}
						/>
					) : null}
				</WorkspaceSideTarget>
			</dialog>
		</div>
	);
}
