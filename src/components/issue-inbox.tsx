"use client";
import { useCallback, useEffect, useId, useRef, useState, useMemo, useSyncExternalStore } from "react";
import type { IssueCurrent, IssueSummary } from "@/lib/issues";
import { api, ApiError, readCached, onApiSessionCleared } from "./api";
import { useApiRevalidation } from "./use-api-revalidation";
import { IssueDetail } from "./issue-detail";
import { useProjectDialog } from "./projects-motion";
import { WorkspaceSideTarget } from "./workspace-side-content";
import { WorkspaceIcon } from "./workspace-ui";
import { taskInboxState } from "./task-inbox-state";
import { groupTaskCards, type TaskCard } from "./task-inbox-groups";
import { TaskCardRows } from "./task-card-rows";
import { InboxReader } from "./inbox-reader";
import { useProjectUpdates } from "./project-live";
import { IssueTargetPreview } from "./issue-target-preview";
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
	const url = `${base}/issues`;
	const [initial] = useState(() => readCached<{ items: IssueSummary[]; counts: Record<string, number>; nextCursor: string | null }>(url));
	const titleId = useId();
	const [opened, setOpened] = useState(false);
	const [selected, setSelected] = useState<TaskCard | null>(null);
	const [items, setItems] = useState<IssueSummary[]>(initial?.items ?? []);
	const [counts, setCounts] = useState<Record<string, number>>(initial?.counts ?? {});
	const [loading, setLoading] = useState(!initial);
	const [loaded, setLoaded] = useState(!!initial);
	const [error, setError] = useState("");
	const dirty = useRef(false);
	const callbacks = useRef({ onInvalid, onDirty });
	callbacks.current = { onInvalid, onDirty };
	const generation = useRef(0);
	const reading = useRef<AbortController | null>(null);
	const handleDirty = useCallback((value: boolean) => {
		dirty.current = value;
		callbacks.current.onDirty(value);
	}, []);
	const reader = useMemo(() => new InboxReader(base, () => callbacks.current.onInvalid()), [base]);
	const batch = useSyncExternalStore(reader.subscribe, reader.getSnapshot, reader.getSnapshot);
	useEffect(() => {
		reader.activate();
		const off = onApiSessionCleared(() => reader.clear(true));
		return () => { off(); reader.dispose(); };
	}, [reader]);
	useEffect(() => { if (opened) reader.open(); else reader.close(); }, [reader, opened]);
	useProjectUpdates(updates => reader.updates(updates));
	const load = useCallback(
		async (next: string | null = null) => {
			const run = ++generation.current;
			reading.current?.abort();
			const controller = new AbortController();
			reading.current = controller;
			setLoading(true);
			try {
				const data = await api<{
					items: IssueSummary[];
					counts: Record<string, number>;
					nextCursor: string | null;
				}>(
					`${url}${next ? `?cursor=${encodeURIComponent(next)}` : ""}`,
					"GET",
					undefined,
					{ signal: controller.signal },
				);
				if (run !== generation.current || controller.signal.aborted) return;
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
				setError("");
				setLoaded(true);
			} catch (e) {
				if (run !== generation.current) return;
				if (e instanceof ApiError && e.status === 401)
					callbacks.current.onInvalid();
				setError(e instanceof Error ? e.message : "无法读取待办。");
			} finally {
				if (run === generation.current) {
					setLoading(false);
				}
			}
		},
		[url],
	);
	useApiRevalidation(() => { void load(); reader.refresh(); });
	useEffect(() => {
		void refreshKey;
		void load();
	}, [load, refreshKey]);

	useEffect(
		() => () => {
			generation.current++;
			reading.current?.abort();
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
	const shownItems = opened && batch.loaded ? batch.items : items;
	const shownError = opened ? batch.error || (!batch.loaded ? error : "") : error;
	const badge = taskInboxState(opened && batch.loaded ? batch.counts : counts, guest, !!shownError || !loaded);
	const groups = groupTaskCards(shownItems);
	const current = selected
		? (groupTaskCards([...shownItems, ...selected.items.map(item => batch.views.get(item.id) ?? item)])
				.flatMap((group) => group.cards)
				.find((card) => card.id === selected.id) ?? { ...selected, items: selected.items.map(item => batch.views.get(item.id) ?? item) })
		: null;
	const selectedIds = current?.items.map(item => item.id).join(",") ?? "";
	useEffect(() => { void batch.epoch; handleDirty(false); }, [handleDirty, batch.epoch]);
	useEffect(() => { void batch.epoch; reader.select(selectedIds ? selectedIds.split(",") : []); }, [reader, selectedIds, batch.epoch]);
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
					{batch.loading ? <p role="status">{batch.loaded ? "正在准备其余待办…" : "正在准备待办与填写信息…"}</p> : null}
					{shownError ? (
						<p className="error" role="alert">
							{shownError}
							<button type="button" onClick={() => reader.refresh()}>
								重试
							</button>
						</p>
					) : null}
					{!batch.loading && !shownError && batch.loaded && !groups.length ? (
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
					{batch.nextCursor ? (
						<button
							type="button"
							disabled={batch.loading}
							onClick={() => reader.more()}
						>
							加载更多事项
						</button>
					) : null}
				</div>
				<WorkspaceSideTarget value={null}>
					{current ? (
						<TaskCardDetail
							key={`${base}:${batch.epoch}:${current.items[0]?.fileId}`}
							card={current}
							base={base}
							guest={guest}
							onInvalid={onInvalid}
							onUpdated={onUpdated}
							onDirty={handleDirty}
							onSnapshot={reader.accept}
							views={batch.views}
							unavailable={batch.unavailable}
							onReadRequest={(id) => reader.reload([id])}
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
	onSnapshot: (issue: IssueCurrent) => void;
	views: ReadonlyMap<string, IssueCurrent>;
	unavailable: ReadonlySet<string>;
	onReadRequest: (id: string) => void;
	onCollapse: () => void;
};
function TaskCardDetail(props: CardDetailProps) {
	const issue = props.card.items.map(item => props.views.get(item.id)).find(Boolean) ?? null;
	// Retain the photo while an unprepared target loads, without retaining the old annotation.
	const image = issue?.target?.image ?? (props.card.items[0]?.kind === "measurement"
		? [...props.views.values()].find(view => view.fileId === props.card.items[0]?.fileId && view.target)?.target?.image : null);
	const status = {
		pending: props.card.items.filter(item => !item.closedAt && item.state === "awaiting_response").length,
		remeasure: props.card.items.filter(item => !item.closedAt && item.state === "remeasure_requested").length,
		submitted: props.card.items.filter(item => !item.closedAt && item.state === "submitted").length,
	};
	return (
		<section className="task-selected-detail" aria-label={props.card.label}>
			<header className="task-selected-heading">
				<h3>{props.card.label}</h3>
				<button type="button" aria-label="收起当前事项" onClick={props.onCollapse}>
					<WorkspaceIcon kind="chevron" />
				</button>
			</header>
			{image ? <IssueTargetPreview key={image.imageHash} base={props.base} issue={issue} image={image} status={status} onInvalid={props.onInvalid} /> : null}
			{issue && !issue.target ? <p className="task-file-download"><a href={`${props.base}/files/${issue.fileId}/download`}>下载 {issue.file.filename}</a></p> : null}
			<TaskCardForms key={props.card.id} {...props} />
		</section>
	);
}

function TaskCardForms(props: CardDetailProps) {
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
		<>
			{rows.map((item) => (
				<TaskCardIssue
					key={item.id}
					{...props}
					item={item}
					report={report}
				/>
			))}
		</>
	);
}
function TaskCardIssue({
	item,
	report,
	...props
}: CardDetailProps & {
	item: IssueSummary;
	report: (id: string, value: boolean) => void;
}) {
	const handleDirty = useCallback(
		(value: boolean) => report(item.id, value),
		[report, item.id],
	);
	if (props.unavailable.has(item.id)) return <p role="alert">该事项已不可用，请选择其他事项。</p>;
	return (
		<IssueDetail
			base={props.base}
			id={item.id}
			guest={props.guest}
			inbox
			inline
			showTarget={false}
			managedByInbox
			onReadRequest={props.onReadRequest}
			{...(props.views.get(item.id) ? { currentView: props.views.get(item.id) as IssueCurrent } : {})}
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
