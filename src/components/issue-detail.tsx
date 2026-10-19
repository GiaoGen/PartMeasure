"use client";
import dynamic from "next/dynamic";
import { EvidencePreview } from "./evidence-preview";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type IssueDetail as Detail,
	type IssueWriteResult,
	applyIssueWrite,
	stateLabel,
	methodLabel,
} from "@/lib/issues";
import { api, ApiError } from "./api";
import { useProjectUpdates } from "./project-live";
import { WorkspaceSideContent } from "./workspace-side-content";
import { IssueResponseForm } from "./issue-response-form";
import { IssueReviewForm } from "./issue-review-form";
const Canvas = dynamic(() => import("./annotation-canvas"), {
	ssr: false,
	loading: () => <p role="status">载入目标画布…</p>,
});
const noop = () => {};
const sourceLabel = {
	customer_numeric: "采用客户原数值",
	owner_from_photo: "依据照片人工录入",
	owner_manual: "工程师人工录入／修正",
	comment: "文件问题已处理",
};
export function IssueDetail({
	base,
	id,
	guest,
	onInvalid,
	onUpdated,
	onDirty,
	onBack,
	panelOnly = false,
	onOpenProperties,
	backLabel,
}: {
	base: string;
	id: string;
	guest: boolean;
	onInvalid: () => void;
	onUpdated: () => void;
	onDirty: (dirty: boolean) => void;
	onBack: () => void;
	panelOnly?: boolean;
	onOpenProperties?: () => void;
	backLabel?: string;
}) {
	const [issue, setIssue] = useState<Detail | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState(""),
		[formVersion, setFormVersion] = useState(0),
		[canvasError, setCanvasError] = useState("");
	const [targetExpanded, setTargetExpanded] = useState(false);
	const [committedPending, setCommittedPending] = useState(false),
		[savedNotice, setSavedNotice] = useState("");
	const generation = useRef(0),
		dirty = useRef(false),
		callbacks = useRef({ onInvalid, onUpdated });
	callbacks.current = { onInvalid, onUpdated };
	const handleDirty = useCallback(
		(value: boolean) => {
			dirty.current = value;
			onDirty(value);
		},
		[onDirty],
	);
	const load = useCallback(
		async (reset = false) => {
			const run = ++generation.current;
			if (reset) setLoading(true);
			try {
				const data = await api<Detail>(`${base}/issues/${id}`, "GET", undefined, { cacheMs: reset ? 0 : 1000 });
				if (run !== generation.current) return;
				if (dirty.current && !reset) { setSavedNotice("对方已更新；当前输入已保留，提交时检查修订冲突。"); return; }
				setIssue(data);
				setCommittedPending(false);
				setError("");
				if (reset) setFormVersion((v) => v + 1);
			} catch (e) {
				if (run !== generation.current) return;
				if (e instanceof ApiError && e.status === 401)
					callbacks.current.onInvalid();
				setError(e instanceof Error ? e.message : "无法读取任务。");
			} finally {
				if (run === generation.current) setLoading(false);
			}
		},
		[base, id],
	);
	useEffect(() => {
		void load(true);
        return () => { generation.current++; };
	}, [load]);
 useProjectUpdates(updates => {
  if (!updates.some(e => e.kind === "resync" || (e.kind === "issue.changed" && e.entityId === id) || (e.kind === "file.changed" && issue?.responses.some(r=>r.attachments.some(f=>f.id===e.fileId))))) return;
  if (dirty.current) setSavedNotice("对方已更新；当前输入已保留，提交时检查修订冲突。");
  else void load();
 });

	function reload() {
		void load(true);
	}
	function saved(result: IssueWriteResult) {
		const updated = issue ? applyIssueWrite(issue, result) : null;
		if (updated) {
			generation.current++;
			setIssue(updated);
			setFormVersion(v => v + 1);
			setCommittedPending(false);
			setSavedNotice("本次提交已保存。");
			setError("");
			setLoading(false);
			callbacks.current.onUpdated();
			return;
		}
		// Old deployment/idempotency records may not include a delta: fetch normally.
		setCommittedPending(true);
		setSavedNotice("本次提交已保存，正在读取最新状态。");
		void load(true);
		callbacks.current.onUpdated();
	}
	if (loading)
		return (
			<WorkspaceSideContent>
				<p role="status">读取测量位置、回复与审核历史…</p>
			</WorkspaceSideContent>
		);
	if (!issue)
		return (
			<WorkspaceSideContent>
				<div>
					<p role="alert" className="error">
						{error || "任务暂时不可用。"}
					</p>
					<button type="button" onClick={reload}>
						重试任务
					</button>
				</div>
			</WorkspaceSideContent>
		);
	const target = issue.target,
		lastReview = issue.reviews.at(-1);
	const events = [
		...issue.responses.map((response) => ({
			type: "response" as const,
			at: response.createdAt,
			response,
		})),
		...issue.reviews.map((review) => ({
			type: "review" as const,
			at: review.createdAt,
			review,
		})),
	].sort((a, b) => a.at.localeCompare(b.at));
	const canReply =
		issue.state === "awaiting_response" ||
		issue.state === "remeasure_requested";
	const mainContent = (
		<>
			<div className="detail-heading">
				<h2>{issue.title}</h2>
				<button type="button" onClick={onBack}>
					{backLabel ?? (panelOnly ? "返回标注" : "返回资料")}
				</button>
			</div>
			<p className="issue-state">
				{stateLabel[issue.state]} ·{" "}
				{issue.kind === "measurement" ? "测量提醒" : "文件级文字问题"}
			</p>
			{savedNotice ? (
				<p role="status">
					{savedNotice}
				</p>
			) : null}
			{error ? (
				<p role="alert" className="error">
					{error}
					<button type="button" onClick={() => void load()}>
						重试读取任务
					</button>
				</p>
			) : null}
			<details
				className="issue-target"
				open={!panelOnly || targetExpanded}
				onToggle={(event) => setTargetExpanded(event.currentTarget.open)}
			>
				<summary>测量位置与要求</summary>
				<h3>{target ? "测哪里" : "对应文件"}</h3>
				<p>{issue.targetInfo || issue.file.filename}</p>
				{target && (!panelOnly || targetExpanded) ? (
					<>
						<details className="target-revision">
							<summary>测量位置记录</summary>
							<p>修订 #{target.annotationRef.revision}，保留发送时的位置。</p>
						</details>
						<Canvas
							image={target.image}
							src={`${base}/files/${issue.fileId}/preview`}
							items={[target.annotation]}
							selected={target.annotationRef.id}
							showNumbers={false}
							guest
							disabled
							onSelect={() => onOpenProperties?.()}
							onCreate={noop}
							onChange={noop}
							onDelete={noop}
							onUndo={noop}
							onRedo={noop}
							onSave={noop}
							onError={setCanvasError}
							onInvalid={onInvalid}
						/>
						{canvasError ? (
							<p role="alert" className="error">
								{canvasError}
							</p>
						) : null}
					</>
				) : (
					<p>
						{issue.file.filename} ·{" "}
						<a href={`${base}/files/${issue.fileId}/download`}>下载附件</a>
					</p>
				)}
			</details>{" "}
		</>
	);
	return (
		<section
			className="issue-detail"
			data-panel-only={panelOnly}
			aria-label="任务详情"
		>
			{panelOnly ? (
				<WorkspaceSideContent>
					<div className="issue-popup-main">{mainContent}</div>
				</WorkspaceSideContent>
			) : (
				<div className="issue-main">{mainContent}</div>
			)}
			<WorkspaceSideContent>
				<aside className="issue-actions">
					{panelOnly && issue.targetInfo ? (
						<p className="preserve-lines">{issue.targetInfo}</p>
					) : null}
					<h2>{guest ? "测量提醒与回复" : "测量审核"}</h2>
					<h3>{issue.kind === "measurement" ? "怎么测" : "问题说明"}</h3>
					{issue.kind === "measurement" ? (
						<p>建议使用：{methodLabel[issue.measurementMethod]}</p>
					) : null}
					<p className="preserve-lines">{issue.description}</p>
					{issue.state === "remeasure_requested" ? (
						<p role="status" className="remeasure-note">
							{issue.kind === "measurement" ? "请重新测量" : "请补充说明"}：
							{lastReview?.note}
						</p>
					) : null}
					{issue.state === "submitted" ? (
						<p role="status">
							{guest
								? "已提交，等待工程师审核。"
								: "核对回复后确认或要求重新测量。"}
						</p>
					) : null}
					{issue.state === "confirmed" ? (
						<div className="confirmation-readout">
							<h3>{issue.kind === "measurement" ? "最终确认" : "处理结果"}</h3>
							{lastReview?.value ? (
								<p>
									{lastReview.value} {lastReview.unit}
								</p>
							) : null}
							<p>{lastReview?.source ? sourceLabel[lastReview.source] : ""}</p>
							<p className="preserve-lines">{lastReview?.note}</p>
							<p>已确认，历史保留。</p>
						</div>
					) : null}
					{guest && canReply && !committedPending ? (
						<IssueResponseForm
							key={`${issue.id}:${issue.revision}:${formVersion}`}
							base={base}
							issue={issue}
							onSaved={saved}
							onInvalid={onInvalid}
							onDirty={handleDirty}
							onReload={reload}
						/>
					) : null}
					{!guest && issue.state === "submitted" && !committedPending ? (
						<IssueReviewForm
							key={`${issue.id}:${issue.revision}:${formVersion}`}
							base={base}
							issue={issue}
							onSaved={saved}
							onInvalid={onInvalid}
							onDirty={handleDirty}
							onReload={reload}
						/>
					) : null}
					{!guest && canReply ? (
						<p>
							等待客户
							{issue.state === "remeasure_requested" ? "重新提交" : "回复"}。
						</p>
					) : null}
				</aside>
			</WorkspaceSideContent>
			<WorkspaceSideContent>
				<details
					className="issue-history-disclosure"
					open={issue.state === "submitted"}
				>
					<summary>回复与审核历史</summary>
					<section className="issue-history" aria-label="回复与审核历史">
						<h3>回复与审核历史</h3>
						{!events.length ? <p>尚无回复。</p> : null}
						<ol>
							{events.map((event) =>
								event.type === "response" ? (
									<li key={event.response.id}>
										<h4>
											{
												{
													numeric: "数值回复",
													photo: "仅照片回复",
													unable: "无法测量",
													text: "文字回复",
												}[event.response.kind]
											}
										</h4>
										<small>
											{new Date(event.at).toLocaleString("zh-CN")} ·{" "}
											{event.response.authorType === "owner"
												? "工程师"
												: `客户${event.response.guestLabel ? `（自填称呼：${event.response.guestLabel}）` : ""}`}
										</small>
										{event.response.value ? (
											<p>
												原回复：{event.response.value} {event.response.unit}
											</p>
										) : null}
										<p className="preserve-lines">{event.response.body}</p>
										<ul className="evidence-gallery">
											{event.response.attachments.map((file) => (
												<li key={file.id}>
													{file.mime.startsWith("image/") ? (
														<a href={`${base}/files/${file.id}/download`}>
															<EvidencePreview base={base} file={file} />
														</a>
													) : null}
													<a href={`${base}/files/${file.id}/download`}>
														{file.filename}
													</a>
													{file.mime.startsWith("image/") ? (
														<p>
															<a
																href={`${base}/files/${file.id}/preview`}
																target="_blank"
																rel="noopener noreferrer"
															>
																查看原尺寸证据
															</a>
														</p>
													) : null}
												</li>
											))}
										</ul>
									</li>
								) : (
									<li key={event.review.id}>
										<h4>
											{event.review.decision === "confirm"
												? "工程师已确认"
												: "工程师要求补充／重测"}
										</h4>
										<small>{new Date(event.at).toLocaleString("zh-CN")}</small>
										{event.review.value ? (
											<p>
												确认值：{event.review.value} {event.review.unit}
											</p>
										) : null}
										<p>
											{event.review.source
												? sourceLabel[event.review.source]
												: ""}
										</p>
										<p className="preserve-lines">{event.review.note}</p>
									</li>
								),
							)}
						</ol>
					</section>
				</details>
			</WorkspaceSideContent>
		</section>
	);
}
