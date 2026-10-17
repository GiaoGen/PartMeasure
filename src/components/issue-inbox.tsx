"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type IssueSummary, stateLabel } from "@/lib/issues";
import { api, ApiError } from "./api";
export function IssueInbox({
	base,
	guest,
	refreshKey,
	onSelect,
	onInitial,
	onInvalid,
	onBrowse,
}: {
	base: string;
	guest: boolean;
	refreshKey: number;
	onSelect: (id: string) => void;
	onInitial?: (id: string) => void;
	onInvalid: () => void;
	onBrowse: () => void;
}) {
	const [items, setItems] = useState<IssueSummary[]>([]),
		[counts, setCounts] = useState<Record<string, number>>({}),
		[cursor, setCursor] = useState<string | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState("");
	const first = useRef(true),
		callbacks = useRef({ onInitial, onInvalid });
	callbacks.current = { onInitial, onInvalid };
	const run = useRef(0);
	const load = useCallback(
		async (next: string | null = null) => {
			const current = ++run.current;
			setLoading(true);
			try {
				const result = await api<{
					items: IssueSummary[];
					counts: Record<string, number>;
					nextCursor: string | null;
				}>(`${base}/issues${next ? `?cursor=${next}` : ""}`);
				if (current !== run.current) return;
				setItems((old) => (next ? [...old, ...result.items] : result.items));
				setCounts(result.counts);
				setCursor(result.nextCursor);
				setError("");
				if (first.current) {
					first.current = false;
					const target = result.items.find((i) =>
						guest
							? i.state === "awaiting_response" ||
								i.state === "remeasure_requested"
							: i.state === "submitted",
					);
					if (target) callbacks.current.onInitial?.(target.id);
				}
			} catch (e) {
				if (current !== run.current) return;
				if (e instanceof ApiError && e.status === 401)
					callbacks.current.onInvalid();
				setError(e instanceof Error ? e.message : "无法读取待办。");
			} finally {
				if (current === run.current) setLoading(false);
			}
		},
		[base, guest],
	);
	useEffect(() => {
		void refreshKey;
		void load();
		return () => {
			run.current++;
		};
	}, [load, refreshKey]);
	const priority = (i: IssueSummary) =>
		guest
			? i.state === "awaiting_response" || i.state === "remeasure_requested"
				? 0
				: i.state === "submitted"
					? 1
					: 2
			: i.state === "submitted"
				? 0
				: i.state === "confirmed"
					? 2
					: 1;
	return (
		<section
			className="issue-inbox"
			aria-label={guest ? "客户待测汇总" : "工程师待审核汇总"}
		>
			<div className="detail-heading">
				<h2>
					{guest
						? `待回复 ${(counts.awaiting_response ?? 0) + (counts.remeasure_requested ?? 0)} 项`
						: `待审核 ${counts.submitted ?? 0} 项`}
				</h2>
				<div className="actions">
					<button type="button" onClick={onBrowse}>
						继续上传资料
					</button>
					<button type="button" disabled={loading} onClick={() => void load()}>
						刷新任务
					</button>
				</div>
			</div>
			<p className="muted">
				待回复 {counts.awaiting_response ?? 0} · 重测{" "}
				{counts.remeasure_requested ?? 0} · 待审核 {counts.submitted ?? 0} ·
				已确认 {counts.confirmed ?? 0}
			</p>
			{loading ? (
				<p role="status">读取任务…</p>
			) : !items.length ? (
				<p>尚无测量请求或文件问题，可以继续上传资料。</p>
			) : null}
			{error ? (
				<p role="alert" className="error">
					{error}
				</p>
			) : null}
			<details open={!guest}>
				<summary>任务列表（当前 {items.length} 项）</summary>
				<ul className="issue-inbox-list">
					{[...items]
						.sort((a, b) => priority(a) - priority(b))
						.map((i) => (
							<li key={i.id}>
								<button type="button" onClick={() => onSelect(i.id)}>
									<span>
										{i.kind === "measurement" ? "测量" : "文件问题"} · {i.title}
									</span>
									<small>{stateLabel[i.state]}</small>
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
						更多任务
					</button>
				) : null}
			</details>
		</section>
	);
}
