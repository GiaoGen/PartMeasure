"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IssueSummary } from "@/lib/issues";
import { api, ApiError } from "./api";
import { IssueDetail } from "./issue-detail";
import { useProjectUpdates } from "./project-live";

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
}) {
	const [items, setItems] = useState<IssueSummary[]>([]),
		[cursor, setCursor] = useState<string | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState(""),
		[historyOpen, setHistoryOpen] = useState(false);
	const callbacks = useRef({ onInvalid, onUpdated, onDirty });
	callbacks.current = { onInvalid, onUpdated, onDirty };
	const dirty = useRef(new Set<string>()),
		generation = useRef(0);
	const dirtyHandlers = useRef(new Map<string, (value: boolean) => void>());
	const load = useCallback(
		async (next: string | null = null) => {
			const run = ++generation.current;
			setLoading(true);
			try {
				const data = await api<{
					items: IssueSummary[];
					nextCursor: string | null;
				}>(
					`${base}/files/${fileId}/issues?annotationId=${annotationId}${next ? `&cursor=${encodeURIComponent(next)}` : ""}`,
					"GET",
					undefined,
					{ cacheMs: 1000 },
				);
				if (run !== generation.current) return;
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
				if (run !== generation.current) return;
				if (e instanceof ApiError && e.status === 401)
					callbacks.current.onInvalid();
				setError(e instanceof Error ? e.message : "无法读取补充状态。");
			} finally {
				if (run === generation.current) setLoading(false);
			}
		},
		[base, fileId, annotationId],
	);
	useEffect(() => {
		void refreshKey;
		void load();
		return () => {
			generation.current++;
		};
	}, [load, refreshKey]);
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
	const render = (item: IssueSummary) => {
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
				guest={guest}
				inline
				compact={compact}
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
