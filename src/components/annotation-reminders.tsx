"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type IssueSummary, stateLabel } from "@/lib/issues";
import { api, ApiError } from "./api";

export function AnnotationReminders({
	base,
	fileId,
	annotationId,
	refreshKey,
	onOpen,
	onInvalid,
	onInitial,
}: {
	base: string;
	fileId: string;
	annotationId: string;
	refreshKey: number;
	onOpen: (id: string) => void;
	onInvalid: () => void;
	onInitial?: ((id: string) => void) | undefined;
}) {
	const [items, setItems] = useState<IssueSummary[]>([]),
		[cursor, setCursor] = useState<string | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState("");
	const generation = useRef(0),
		invalid = useRef(onInvalid);
	invalid.current = onInvalid;
	const initial = useRef(onInitial),
		opened = useRef(false);
	initial.current = onInitial;
	const load = useCallback(
		async (next: string | null = null) => {
			const run = ++generation.current;
			setLoading(true);
			setError("");
			try {
				const data = await api<{
					items: IssueSummary[];
					nextCursor: string | null;
				}>(
					`${base}/files/${fileId}/issues?annotationId=${encodeURIComponent(annotationId)}${next ? `&cursor=${encodeURIComponent(next)}` : ""}`,
					"GET", undefined, { cacheMs: 1000 },
				);
				if (run !== generation.current) return;
				const related = data.items.filter(
					item => item.kind === "measurement" && item.fileId === fileId && item.annotationRef?.id === annotationId,
				);
				if (run !== generation.current) return;
				setItems((old) =>
					next
						? [
								...old,
								...related.filter(
									(item) => !old.some((previous) => previous.id === item.id),
								),
							]
						: related,
				);
				setCursor(data.nextCursor);
				if (!next && !data.nextCursor && !opened.current) {
					const actionable = related.filter(
						(item) =>
							item.state === "awaiting_response" ||
							item.state === "remeasure_requested",
					);
					const target =
						actionable.length === 1
							? actionable[0]
							: related.length === 1
								? related[0]
								: null;
					if (target && initial.current) {
						opened.current = true;
						initial.current(target.id);
					}
				}
			} catch (e) {
				if (run !== generation.current) return;
				if (e instanceof ApiError && e.status === 401) invalid.current();
				setError(e instanceof Error ? e.message : "读取测量提醒失败。");
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
	return (
		<section className="annotation-reminders" aria-label="此标注的测量提醒">
			<h3>测量提醒</h3>
			{loading ? <p role="status">读取对应提醒…</p> : null}
			{error ? (
				<p role="alert" className="error">
					{error}
					<button type="button" onClick={() => void load()}>
						重试
					</button>
				</p>
			) : null}
			{!loading && !error && !items.length ? (
				<p>{cursor ? "本页暂无对应提醒" : "暂无对应提醒"}</p>
			) : null}
			<ul className="issue-list">
				{items.map((item) => (
					<li key={item.id}>
						<strong>{item.title}</strong>
						<p>{stateLabel[item.state]}</p>
						<button type="button" onClick={() => onOpen(item.id)}>
							查看与回复
						</button>
					</li>
				))}
			</ul>
			{cursor ? (
				<button
					type="button"
					disabled={loading}
					onClick={() => void load(cursor)}
				>
					继续查找更早提醒
				</button>
			) : null}
		</section>
	);
}
