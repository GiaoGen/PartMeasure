"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IssueCurrent, IssueCurrentPage } from "@/lib/issues";
import { ApiError, readCached } from "./api";
import { collaborationUrl, readCollaboration } from "./interaction-reads";
import { useApiRevalidation } from "./use-api-revalidation";
import { IssueDetail } from "./issue-detail";
import { useProjectUpdates } from "./project-live";
import type { MeasurementTarget } from "./issue-history";

export function AnnotationCollaboration({
	base,
	fileId,
	annotationId,
	guest,
	compact = false,
	refreshKey,
	onInvalid,
	onUpdated,
	onDirty,
	onViewPosition,
}: {
	base: string;
	fileId: string;
	annotationId: string;
	guest: boolean;
	compact?: boolean;
	refreshKey: number;
	onInvalid: () => void;
	onUpdated: () => void;
	onDirty: (value: boolean) => void;
	onViewPosition?: (target: MeasurementTarget) => void;
}) {
	const url = collaborationUrl(base, fileId, annotationId);
	const [initial] = useState(() => readCached<{ issues: IssueCurrentPage }>(url)?.issues);
	const [items, setItems] = useState<IssueCurrent[]>(initial?.items ?? []),
		[cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null),
		[loading, setLoading] = useState(!initial),
		[error, setError] = useState(""),
		[historyOpen, setHistoryOpen] = useState(false);
	const callbacks = useRef({ onInvalid, onUpdated, onDirty });
	callbacks.current = { onInvalid, onUpdated, onDirty };
	const dirty = useRef(new Set<string>()),
		generation = useRef(0);
	const dirtyHandlers = useRef(new Map<string, (value: boolean) => void>());
	const reading = useRef<AbortController | null>(null);
	const activeRead = useRef<{ cursor: string | null; busy: boolean }>({ cursor: null, busy: false });
	const load = useCallback(
		async (next: string | null = null) => {
			if (activeRead.current.busy && activeRead.current.cursor === next && !reading.current?.signal.aborted) return;
			activeRead.current = { cursor: next, busy: true };
			const run = ++generation.current;
			reading.current?.abort();
			const controller = new AbortController();
			reading.current = controller;
			setLoading(true);
			try {
				const data = await readCollaboration(base, fileId, annotationId, next, { signal: controller.signal });
				if (run !== generation.current || controller.signal.aborted) return;
				const related = data.items.filter(
					(i) =>
						i.kind === "measurement" &&
						i.annotationRef?.id === annotationId &&
						i.fileId === fileId,
				);
				setItems((old) =>
					next
						? [
								...old,
								...related.filter((i) => !old.some((o) => o.id === i.id)),
							]
						: [
								...related.filter((i) => !dirty.current.has(i.id)),
								...old.filter((i) => dirty.current.has(i.id)),
							],
				);
				setCursor(data.nextCursor);
				setError("");
			} catch (e) {
				if (run !== generation.current || controller.signal.aborted) return;
				if (e instanceof ApiError && e.status === 401)
					callbacks.current.onInvalid();
				setError(e instanceof Error ? e.message : "无法读取补充状态。");
			} finally {
				if (run === generation.current) { activeRead.current.busy = false; setLoading(false); }
			}
		},
		[base, fileId, annotationId],
	);
	useEffect(() => {
		void refreshKey;
		void load();
		return () => {
			generation.current++;
			reading.current?.abort();
		};
	}, [load, refreshKey]);
	useApiRevalidation(() => void load());
	useEffect(() => () => callbacks.current.onDirty(false), []);
	useProjectUpdates((events) => {
		if (
			events.some(
				(e) =>
					e.kind === "resync" ||
					(e.kind === "issue.changed" && e.fileId === fileId),
			)
		)
			void load();
	});
	const active = items.filter((i) => !i.closedAt && i.state !== "confirmed");
	const history = items.filter((i) => i.closedAt || i.state === "confirmed");
	const updated = useCallback(() => {
		void load();
		callbacks.current.onUpdated();
	}, [load]);
	const render = (item: IssueCurrent) => {
		let handleDirty = dirtyHandlers.current.get(item.id);
		if (!handleDirty) {
			handleDirty = (value) => {
				if (value) dirty.current.add(item.id);
				else dirty.current.delete(item.id);
				callbacks.current.onDirty(dirty.current.size > 0);
			};
			dirtyHandlers.current.set(item.id, handleDirty);
		}
		return (
			<IssueDetail
				key={item.id}
				base={base}
				id={item.id}
				currentView={item}
				guest={guest}
				inline
				compact={compact}
				{...(onViewPosition ? { onViewPosition } : {})}
				onInvalid={onInvalid}
				onUpdated={updated}
				onBack={() => {}}
				onDirty={handleDirty}
			/>
		);
	};
	if (!guest && !loading && !error && !items.length) return null;
	return (
		<section className="annotation-collaboration" aria-label="标注补充与记录">
			{!guest ? (
				<h3 className="annotation-collaboration-title">客户补充</h3>
			) : null}
			{loading && !items.length ? <p role="status">读取补充状态…</p> : null}
			{error ? (
				<p role="alert">
					{error}
					<button type="button" onClick={() => void load()}>
						重试
					</button>
				</p>
			) : null}
			{!loading && !error && !active.length ? (
				<p role="status">
					{history.length
						? "当前没有待补充项。"
						: compact
							? "此标注无需补充尺寸。"
							: "无需补充；缺少尺寸的测量标注保存后会自动提示。"}
				</p>
			) : null}
			{active.map(render)}
			{history.length ? (
				<details onToggle={(e) => setHistoryOpen(e.currentTarget.open)}>
					<summary>已完成与历史（{history.length}）</summary>
					{historyOpen ? history.map(render) : null}
				</details>
			) : null}
			{cursor ? (
				<button
					type="button"
					disabled={loading}
					onClick={() => void load(cursor)}
				>
					更多记录
				</button>
			) : null}
		</section>
	);
}
