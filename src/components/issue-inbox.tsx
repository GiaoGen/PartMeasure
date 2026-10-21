"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { IssueDetail as IssueData, IssueSummary } from "@/lib/issues";
import { api, ApiError } from "./api";
import { IssueDetail } from "./issue-detail";
import { useProjectDialog } from "./projects-motion";
import { WorkspaceSideTarget } from "./workspace-side-content";
import { WorkspaceIcon } from "./workspace-ui";
import { taskInboxState } from "./task-inbox-state";
import { groupTaskCards, type TaskCard } from "./task-inbox-groups";
import { TaskCardRows } from "./task-card-rows";
import "./issue-inbox.css";

export function IssueInbox({
	base,
	guest,
	refreshKey,
	onInvalid,
	onUpdated,
	onDirty,
}: {
	base: string;
	guest: boolean;
	refreshKey: number;
	onInvalid: () => void;
	onUpdated: () => void;
	onDirty: (dirty: boolean) => void;
}) {
	const popup = useProjectDialog();
	const titleId = useId();
	const [opened, setOpened] = useState(false);
	const [selected, setSelected] = useState<TaskCard | null>(null);
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
	const updateItem = useCallback((detail: IssueData) => {
		setItems((old) =>
			old.map((item) =>
				item.id === detail.id ? { ...item, ...detail } : item,
			),
		);
		setSelected((old) =>
			old
				? {
						...old,
						items: old.items.map((item) =>
							item.id === detail.id ? { ...item, ...detail } : item,
						),
					}
				: old,
		);
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
					"GET",
					undefined,
					{ cacheMs: 1000 },
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
					'.task-inbox-heading button[aria-label="关闭待办"]',
				)
				?.focus();
	}, [opened, popup.ref]);
	const choose = (card: TaskCard | null) => {
		if (
			dirty.current &&
			!window.confirm(
				"当前有未保存的输入，切换事项会放弃输入，继续吗？已发出的请求可能仍完成。",
			)
		)
			return;
		handleDirty(false);
		setSelected(card?.id === selected?.id ? null : card);
	};
	function close() {
		// Keep detail mounted: closing is not discarding its reply/review form.
		popup.close(() => setOpened(false));
	}
	const badge = taskInboxState(counts, guest, !!error || !loaded);
	const groups = groupTaskCards(items);
	const current = selected
		? (groupTaskCards([...items, ...selected.items])
				.flatMap((group) => group.cards)
				.find((card) => card.id === selected.id) ?? selected)
		: null;
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
				<section className="task-inbox-legend" aria-label="状态颜色图例">
					<span data-tone="redo">待补测</span>
					<span data-tone="missing">待补充</span>
					<span data-tone="done">已补充</span>
				</section>
				<div className="task-inbox-list">
					{loading ? <p role="status">读取待办…</p> : null}
					{error ? (
						<p className="error" role="alert">
							{error}
							<button type="button" onClick={() => void load()}>
								重试
							</button>
						</p>
					) : null}
					{!loading && !error && loaded && !groups.length ? (
						<div className="task-inbox-empty">
							<WorkspaceIcon kind="check" />
							<p>没有待处理事项</p>
						</div>
					) : null}
					<TaskCardRows
						groups={groups}
						selected={selected?.id ?? null}
						onSelect={choose}
					/>
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
					{current ? (
						<TaskCardDetail
							key={current.id}
							card={current}
							base={base}
							guest={guest}
							onInvalid={onInvalid}
							onUpdated={onUpdated}
							onDirty={handleDirty}
							onSnapshot={updateItem}
							onCollapse={() => choose(null)}
						/>
					) : null}
				</WorkspaceSideTarget>
			</dialog>
		</div>
	);
}

type CardDetailProps = {
	card: TaskCard;
	base: string;
	guest: boolean;
	onInvalid: () => void;
	onUpdated: () => void;
	onDirty: (value: boolean) => void;
	onSnapshot: (issue: IssueData) => void;
	onCollapse: () => void;
};
function TaskCardDetail(props: CardDetailProps) {
	const pending = useRef(new Set<string>());
	const { onDirty } = props;
	const report = useCallback(
		(id: string, value: boolean) => {
			if (value) pending.current.add(id);
			else pending.current.delete(id);
			onDirty(pending.current.size > 0);
		},
		[onDirty],
	);
	// Keep form order stable when a submit changes priority; only the cards reorder.
	const firstId = useRef(props.card.items[0]?.id);
	const rows = [...props.card.items].sort((a, b) =>
		a.id === firstId.current
			? -1
			: b.id === firstId.current
				? 1
				: a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
	);
	return (
		<section className="task-selected-detail" aria-label={props.card.label}>
			<header className="task-selected-heading">
				<h3>{props.card.label}</h3>
				<button
					type="button"
					aria-label="收起当前事项"
					onClick={props.onCollapse}
				>
					<WorkspaceIcon kind="chevron" />
				</button>
			</header>
			{rows.map((item, index) => (
				<TaskCardIssue
					key={item.id}
					{...props}
					item={item}
					showTarget={index === 0}
					report={report}
				/>
			))}
		</section>
	);
}
function TaskCardIssue({
	item,
	showTarget,
	report,
	...props
}: CardDetailProps & {
	item: IssueSummary;
	showTarget: boolean;
	report: (id: string, value: boolean) => void;
}) {
	const handleDirty = useCallback(
		(value: boolean) => report(item.id, value),
		[report, item.id],
	);
	return (
		<IssueDetail
			base={props.base}
			id={item.id}
			guest={props.guest}
			inbox
			inline
			showTarget={showTarget}
			onSnapshot={props.onSnapshot}
			targetStatus={{
				pending: props.card.items.filter(
					(i) => !i.closedAt && i.state === "awaiting_response",
				).length,
				remeasure: props.card.items.filter(
					(i) => !i.closedAt && i.state === "remeasure_requested",
				).length,
				submitted: props.card.items.filter(
					(i) => !i.closedAt && i.state === "submitted",
				).length,
			}}
			onInvalid={props.onInvalid}
			onUpdated={props.onUpdated}
			onDirty={handleDirty}
			onBack={props.onCollapse}
		/>
	);
}
