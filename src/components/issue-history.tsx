"use client";
import { useState } from "react";
import type { Evidence, IssueDetail } from "@/lib/issues";
import { displayUnit } from "@/lib/annotation-collaboration";
import { EvidencePreview } from "./evidence-preview";

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
	const events = historyEvents(issue);
	if (!events.length) return null;
	return (
		<details
			className="issue-history-disclosure reply-history"
			onToggle={(event) => setExpanded(event.currentTarget.open)}
		>
			<summary>
				历史记录<span>{events.length} 条</span>
			</summary>
			{expanded ? (
				<>
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
