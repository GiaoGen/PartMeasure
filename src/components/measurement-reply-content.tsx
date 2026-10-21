"use client";
import {
	displayUnit,
	measurementFieldLabel,
} from "@/lib/annotation-collaboration";
import {
	type IssueDetail,
	type IssueWriteResult,
	methodLabel,
} from "@/lib/issues";
import {
	IssueHistory,
	ReplyEvidence,
	replyTime,
	type MeasurementTarget,
} from "./issue-history";
import { IssueResponseForm } from "./issue-response-form";
import { IssueReviewForm } from "./issue-review-form";

export function MeasurementReplyContent({
	issue,
	base,
	guest,
	committedPending,
	formVersion,
	onSaved,
	onInvalid,
	onDirty,
	onReload,
	onViewPosition,
	showGuidance = false,
}: {
	issue: IssueDetail;
	base: string;
	guest: boolean;
	committedPending: boolean;
	formVersion: number;
	onSaved: (result: IssueWriteResult) => void;
	onInvalid: () => void;
	onDirty: (dirty: boolean) => void;
	onReload: () => void;
	onViewPosition?: (target: MeasurementTarget) => void;
	showGuidance?: boolean;
}) {
	const latest = issue.responses.find(
		(response) => response.id === issue.latestResponseId,
	);
	const lastReview = issue.reviews.at(-1);
	const legacyValue =
		issue.state === "confirmed" && lastReview?.decision === "confirm"
			? lastReview.value
			: null;
	const remeasure = !issue.closedAt && issue.state === "remeasure_requested";
	const canReply =
		!issue.closedAt && (issue.state === "awaiting_response" || remeasure);
	const isComment = issue.kind === "comment";
	const field = isComment
		? "问题说明"
		: issue.target && issue.measurementField
			? measurementFieldLabel(issue.target.annotation, issue.measurementField)
			: "尺寸";
	const metadata = issue.target?.annotation.metadata;
	const instructions =
		metadata?.measurementInstructions?.trim() || issue.description.trim();
	const method = issue.measurementMethod;
	const previous = latest?.value
		? `${latest.value} ${displayUnit(latest.unit)}`
		: latest?.kind === "photo"
			? "测量照片"
			: latest?.kind === "unable"
				? "无法测量"
				: latest
					? "文字说明"
					: "";
	return (
		<section
			className={`measurement-reply ${guest ? "guest-measurement" : "owner-annotation-reply"}`}
			data-remeasure={remeasure}
			aria-label={
				isComment
					? "文件问题回复"
					: guest
						? "当前标注的测量回复"
						: "当前标注的客户补充"
			}
		>
			<header className="annotation-reply-heading">
				<h4>{field}</h4>
				<small className="reply-current-state" data-state={issue.state}>
					{issue.closedAt
						? "已结束"
						: remeasure
							? "待补测"
							: canReply
								? "待补充"
								: "已补充"}
				</small>
			</header>
			{isComment && issue.description ? (
				<p className="preserve-lines">{issue.description}</p>
			) : null}
			{issue.closedAt ? (
				<p className="annotation-reply-meta">
					{issue.closureNote}，历史记录保留。
				</p>
			) : null}
			{remeasure ? (
				<>
					<div className="reply-remeasure-reason" role="status">
						<small>{isComment ? "工程师补充要求" : "工程师补测要求"}</small>
						<p className="preserve-lines">
							{lastReview?.note || "请重新补充本项测量信息。"}
						</p>
					</div>
					{previous ? (
						<p className="reply-previous">上次提交：{previous}</p>
					) : null}
				</>
			) : latest ? (
				<>
					<div className="annotation-reply-value">
						{legacyValue || latest.value ? (
							<>
								{legacyValue || latest.value}{" "}
								<small>
									{displayUnit(
										legacyValue ? (lastReview?.unit ?? null) : latest.unit,
									)}
								</small>
							</>
						) : latest.kind === "photo" ? (
							"已补充测量照片"
						) : latest.kind === "unable" ? (
							"无法测量"
						) : (
							"已补充说明"
						)}
					</div>
					<p className="annotation-reply-meta">
						<span
							className="reply-author"
							data-author={legacyValue ? "owner" : latest.authorType}
						>
							{legacyValue
								? "工程师历史录入"
								: latest.authorType === "owner"
									? "工程师填写"
									: guest
										? "你提交的结果"
										: "客户填写"}
						</span>{" "}
						·{" "}
						{replyTime(
							legacyValue && lastReview
								? lastReview.createdAt
								: latest.createdAt,
						)}
					</p>
					{latest.body ? <p className="preserve-lines">{latest.body}</p> : null}
					<ReplyEvidence base={base} files={latest.attachments} />
				</>
			) : null}
			{(guest || showGuidance) &&
			canReply &&
			!isComment &&
			(instructions || method !== "unspecified") ? (
				<div className="reply-measurement-guidance">
					{method !== "unspecified" ? (
						<p>
							<small>测量方式</small>
							{methodLabel[method]}
						</p>
					) : null}
					{instructions ? (
						<p className="preserve-lines">
							<small>测量说明</small>
							{instructions}
						</p>
					) : null}
				</div>
			) : null}
			{guest && canReply && !committedPending ? (
				<IssueResponseForm
					key={`${issue.id}:${issue.revision}:${formVersion}`}
					base={base}
					issue={issue}
					compact
					onSaved={onSaved}
					onInvalid={onInvalid}
					onDirty={onDirty}
					onReload={onReload}
				/>
			) : null}
			{!guest && canReply ? (
				<p className="reply-waiting">
					{remeasure ? "等待客户重新提交" : "等待客户补充"}
				</p>
			) : null}
			{!guest &&
			!issue.closedAt &&
			issue.state === "submitted" &&
			!committedPending ? (
				<IssueReviewForm
					key={`${issue.id}:${issue.revision}:${formVersion}`}
					base={base}
					issue={issue}
					onSaved={onSaved}
					onInvalid={onInvalid}
					onDirty={onDirty}
					onReload={onReload}
				/>
			) : null}
			{committedPending ? (
				<p role="status">本次提交已保存，正在读取最新状态。</p>
			) : null}
			<IssueHistory
				issue={issue}
				base={base}
				{...(!guest && onViewPosition ? { onViewPosition } : {})}
			/>
		</section>
	);
}
