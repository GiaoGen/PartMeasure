"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Evidence, IssueDetail, IssueHistoryEntry, IssueHistoryPage } from "@/lib/issues";
import { displayUnit } from "@/lib/annotation-collaboration";
import { EvidencePreview } from "./evidence-preview";
import { api } from "./api";

export type MeasurementTarget = NonNullable<IssueDetail["target"]>;
export const replyTime = (value: string) =>
	new Date(value).toLocaleString("zh-CN", {
		month: "numeric",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});

export function ReplyEvidence({
	base,
	files,
	label = "测量证据",
}: {
	base: string;
	files: Evidence[];
	label?: string;
}) {
	const [expanded, setExpanded] = useState(false);
	if (!files.length) return null;
	return (
		<details
			className="reply-evidence"
			onToggle={(event) => setExpanded(event.currentTarget.open)}
		>
			<summary>
				{label} · {files.length} 份
			</summary>
			{expanded ? (
				<ul className="evidence-gallery">
					{files.map((file) => (
						<li key={file.id}>
							<a href={`${base}/files/${file.id}/download`}>
								{file.mime.startsWith("image/") ? (
									<EvidencePreview base={base} file={file} />
								) : null}
								{file.filename}
							</a>
						</li>
					))}
				</ul>
			) : null}
		</details>
	);
}

export function historyEvents(issue: IssueDetail) {
	return [
		...issue.responses.map((response) => ({
			id: `response:${response.id}`,
			at: response.createdAt,
			author: response.authorType,
			action:
				response.kind === "numeric"
					? `提交 ${response.value} ${displayUnit(response.unit)}`
					: response.kind === "photo"
						? "上传测量照片"
						: response.kind === "unable"
							? "说明无法测量"
							: "补充说明",
			body: response.body,
			files: response.attachments,
			label: response.guestLabel,
			source: "",
		})),
		...issue.reviews.map((review) => ({
			id: `review:${review.id}`,
			at: review.createdAt,
			author: "owner" as const,
			action:
				review.decision === "remeasure"
					? issue.kind === "comment"
						? "要求补充说明"
						: "要求补测"
					: review.value
						? `历史确认 ${review.value} ${displayUnit(review.unit)}`
						: "历史确认已处理",
			body: review.note,
			files: [] as Evidence[],
			label: "",
			source: review.source
				? {
						customer_numeric: "采用客户原数值",
						owner_from_photo: "依据照片人工录入",
						owner_manual: "工程师人工录入／修正",
						comment: "文件问题已处理",
					}[review.source]
				: "",
		})),
	].sort((a, b) => a.at.localeCompare(b.at));
}

export function IssueHistory({
	issue,
	base,
	onViewPosition,
}: {
	issue: IssueDetail;
	base: string;
	onViewPosition?: (target: MeasurementTarget) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [records, setRecords] = useState<IssueHistoryEntry[]>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const reading = useRef<AbortController | null>(null);
	const requestedCursor = useRef<string | null>(null);
	const paginated = "view" in issue && issue.view === "current";
	const count = "historyCount" in issue ? Number(issue.historyCount) : issue.responses.length + issue.reviews.length;
	const load = useCallback(async (next: string | null = null) => {
		requestedCursor.current = next;
		reading.current?.abort();
		const controller = new AbortController();
		reading.current = controller;
		setLoading(true);
		setError("");
		try {
			const page = await api<IssueHistoryPage>(`${base}/issues/${issue.id}/history-page${next ? `?cursor=${encodeURIComponent(next)}` : ""}`, "GET", undefined, { signal: controller.signal, cacheVersion: String(issue.revision) });
			if (controller.signal.aborted) return;
			setRecords(old => next ? [...old, ...page.items.filter(item => !old.some(previous => previous.type === item.type && previous.record.id === item.record.id))] : page.items);
			setCursor(page.nextCursor);
		} catch (failure) {
			if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "无法读取历史。");
		} finally { if (!controller.signal.aborted) setLoading(false); }
	}, [base, issue.id, issue.revision]);
	useEffect(() => {
		void issue.revision;
		if (expanded && paginated) void load();
		return () => reading.current?.abort();
	}, [expanded, paginated, load, issue.revision]);
	const events = historyEvents(paginated ? {
		...issue,
		responses: records.flatMap(item => item.type === "response" ? [item.record] : []),
		reviews: records.flatMap(item => item.type === "review" ? [item.record] : []),
	} : issue).reverse();
	if (!count) return null;
	return (
		<details
			className="issue-history-disclosure reply-history"
			onToggle={(event) => setExpanded(event.currentTarget.open)}
		>
			<summary>
				历史记录<span>{count} 条</span>
			</summary>
			{expanded ? (
				<>
					{loading ? <p role="status">载入历史…</p> : null}
					{error ? <p role="alert">{error}<button type="button" onClick={() => void load(requestedCursor.current)}>重试</button></p> : null}
					<ol className="reply-timeline">
						{events.map((event) => (
							<li
								key={event.id}
								className="reply-event"
								data-author={event.author}
							>
								<span className="reply-author" data-author={event.author}>
									{event.author === "owner" ? "工程师" : "客户"}
								</span>
								<div className="reply-event-content">
									<span>{event.action}</span>
									{event.body ? (
										<p className="preserve-lines">{event.body}</p>
									) : null}
									{event.label && event.author === "guest" ? (
										<small>自填称呼：{event.label}</small>
									) : null}
									{event.source ? <small>{event.source}</small> : null}
									<ReplyEvidence
										base={base}
										files={event.files}
										label={issue.kind === "comment" ? "附件" : "测量证据"}
									/>
								</div>
								<time
									dateTime={event.at}
									title={new Date(event.at).toLocaleString("zh-CN")}
								>
									{replyTime(event.at)}
								</time>
							</li>
						))}
					</ol>
					{paginated && cursor ? <button type="button" disabled={loading} onClick={() => void load(cursor)}>更早的记录</button> : null}
					{issue.target && onViewPosition ? (
						<button
							type="button"
							className="reply-position-link"
							onClick={() => {
								if (issue.target) onViewPosition(issue.target);
							}}
						>
							查看当时位置
						</button>
					) : null}
				</>
			) : null}
		</details>
	);
}
