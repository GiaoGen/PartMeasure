"use client";
import {
	displayUnit,
	measurementFieldLabel,
} from "@/lib/annotation-collaboration";
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
	inline = false,
	compact = false,
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
	inline?: boolean;
	compact?: boolean;
	onOpenProperties?: () => void;
	backLabel?: string;
}) {
	const [issue, setIssue] = useState<Detail | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState(""),
		[formVersion, setFormVersion] = useState(0),
		[canvasError, setCanvasError] = useState("");
	const [targetExpanded, setTargetExpanded] = useState(false);
	const [historyExpanded, setHistoryExpanded] = useState(false);
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
				const data = await api<Detail>(
					`${base}/issues/${id}`,
					"GET",
					undefined,
					{ cacheMs: reset ? 0 : 1000 },
				);
				if (run !== generation.current) return;
				if (dirty.current && !reset) {
					setSavedNotice("对方已更新；当前输入已保留，提交时检查修订冲突。");
					return;
				}
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
		return () => {
			generation.current++;
		};
	}, [load]);
	useProjectUpdates((updates) => {
		if (
			!updates.some(
				(e) =>
					e.kind === "resync" ||
					(e.kind === "issue.changed" && e.entityId === id) ||
					(e.kind === "file.changed" &&
						issue?.responses.some((r) =>
							r.attachments.some((f) => f.id === e.fileId),
						)),
			)
		)
			return;
		if (dirty.current)
			setSavedNotice("对方已更新；当前输入已保留，提交时检查修订冲突。");
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
			setFormVersion((v) => v + 1);
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
			<WorkspaceSideContent inline={inline}>
				<p role="status">读取测量位置、回复与补测历史…</p>
			</WorkspaceSideContent>
		);
	if (!issue)
		return (
			<WorkspaceSideContent inline={inline}>
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
	const latestResponse = issue.responses.find(
		(r) => r.id === issue.latestResponseId,
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
		!issue.closedAt &&
		(issue.state === "awaiting_response" ||
			issue.state === "remeasure_requested");
	const historyContent = (
		<details
			className="issue-history-disclosure"
			open={compact ? undefined : inline ? false : issue.state === "submitted"}
			onToggle={(e) => setHistoryExpanded(e.currentTarget.open)}
		>
			<summary>回复与补测历史</summary>
			{!compact || historyExpanded ? (
				<section className="issue-history" aria-label="回复与补测历史">
					<h3>回复与补测历史</h3>
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
											原回复：{event.response.value}{" "}
											{displayUnit(event.response.unit)}
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
											确认值：{event.review.value}{" "}
											{displayUnit(event.review.unit)}
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
			) : null}
		</details>
	);
	if (guest && compact && issue.kind === "measurement")
		return (
			<section className="guest-measurement" aria-label="当前标注的测量回复">
				{savedNotice ? <p role="status">{savedNotice}</p> : null}
				{error ? (
					<p role="alert" className="error">
						{error}
						<button type="button" onClick={() => void load()}>
							重试
						</button>
					</p>
				) : null}
				{issue.state === "remeasure_requested" && lastReview?.note ? (
					<p role="status" className="remeasure-note">
						请重新测量：{lastReview.note}
					</p>
				) : null}
				{canReply && !committedPending ? (
					<IssueResponseForm
						key={`${issue.id}:${issue.revision}:${formVersion}`}
						base={base}
						issue={issue}
						compact
						extraContent={historyContent}
						onSaved={saved}
						onInvalid={onInvalid}
						onDirty={handleDirty}
						onReload={reload}
					/>
				) : (
					<>
						<p role="status">
							{issue.closedAt
								? issue.closureNote || "本项已结束，历史保留。"
								: issue.state === "submitted"
									? "已补充，无需工程师确认。"
									: issue.state === "confirmed"
										? "工程师已确认。"
										: "正在确认提交结果…"}
						</p>
						{latestResponse?.value || lastReview?.value ? (
							<p className="guest-annotation-value">
								{latestResponse?.value ?? lastReview?.value}{" "}
								{displayUnit(latestResponse?.unit ?? lastReview?.unit ?? null)}
							</p>
						) : null}
						<details className="guest-measurement-more">
							<summary>
								更多选项<span>本项记录</span>
							</summary>
							{historyContent}
						</details>
					</>
				)}
			</section>
		);
	const mainContent = (
		<>
			<div className="detail-heading">
				<h2>{issue.title}</h2>
				{!inline ? (
					<button type="button" onClick={onBack}>
						{backLabel ?? (panelOnly ? "返回标注" : "返回资料")}
					</button>
				) : null}
			</div>
			<p className="issue-state">
				{issue.closedAt ? "已结束" : stateLabel[issue.state]} ·{" "}
				{issue.kind === "measurement"
					? issue.target && issue.measurementField
						? measurementFieldLabel(
								issue.target.annotation,
								issue.measurementField,
							)
						: "尺寸补充"
					: "文件级文字问题"}
			</p>
			{savedNotice ? <p role="status">{savedNotice}</p> : null}
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
				open={inline ? targetExpanded : !panelOnly || targetExpanded}
				onToggle={(event) => setTargetExpanded(event.currentTarget.open)}
			>
				<summary>测量位置与要求</summary>
				<h3>{target ? "测哪里" : "对应文件"}</h3>
				<p>{issue.targetInfo || issue.file.filename}</p>
				{target && ((!panelOnly && !inline) || targetExpanded) ? (
					<>
						<details className="target-revision">
							<summary>测量位置记录</summary>
							<p>
								修订 #{target.annotationRef.revision}，保留本次补充对应的位置。
							</p>
						</details>
						<Canvas
							image={target.image}
							src={`${base}/files/${issue.fileId}/preview`}
							items={[
								{
									...target.annotation,
									collaboration: {
										pending:
											!issue.closedAt && issue.state === "awaiting_response"
												? 1
												: 0,
										remeasure:
											!issue.closedAt && issue.state === "remeasure_requested"
												? 1
												: 0,
										submitted:
											!issue.closedAt && issue.state === "submitted" ? 1 : 0,
									},
								},
							]}
							selected={target.annotationRef.id}
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
			className={`issue-detail${inline ? " inline-collaboration" : ""}`}
			data-panel-only={panelOnly}
			aria-label="任务详情"
		>
			{panelOnly ? (
				<WorkspaceSideContent inline={inline}>
					<div className="issue-popup-main">{mainContent}</div>
				</WorkspaceSideContent>
			) : (
				<div className="issue-main">{mainContent}</div>
			)}
			<WorkspaceSideContent inline={inline}>
				<aside className="issue-actions">
					{panelOnly && issue.targetInfo ? (
						<p className="preserve-lines">{issue.targetInfo}</p>
					) : null}
					{!inline ? (
						<h2>{issue.kind === "measurement" ? "标注与属性" : "文件问题"}</h2>
					) : null}
					{issue.closedAt ? (
						<p role="status">{issue.closureNote}，原回复及证据已保留。</p>
					) : null}
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
								? "已补充，无需工程师确认。"
								: "客户已补充。如有问题，可要求补测。"}
						</p>
					) : null}
					{issue.state === "confirmed" ? (
						<div className="confirmation-readout">
							<h3>{issue.kind === "measurement" ? "最终确认" : "处理结果"}</h3>
							{lastReview?.value ? (
								<p>
									{lastReview.value} {displayUnit(lastReview.unit)}
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
					{!guest && !issue.closedAt && issue.state === "submitted" ? (
						<section aria-label="客户本次提交">
							<h3>客户本次提交</h3>
							{issue.responses
								.filter((r) => r.id === issue.latestResponseId)
								.map((r) => (
									<div key={r.id}>
										<p>
											{r.value
												? `${r.value} ${displayUnit(r.unit)}`
												: r.kind === "unable"
													? "无法测量"
													: "测量照片"}
										</p>
										<p className="preserve-lines">{r.body}</p>
										{r.attachments.map((file) => (
											<a
												key={file.id}
												href={`${base}/files/${file.id}/download`}
											>
												{file.mime.startsWith("image/") ? (
													<EvidencePreview base={base} file={file} />
												) : (
													file.filename
												)}
											</a>
										))}
									</div>
								))}
						</section>
					) : null}
					{!guest &&
					!issue.closedAt &&
					issue.state === "submitted" &&
					!committedPending ? (
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
			<WorkspaceSideContent inline={inline}>
				{historyContent}
			</WorkspaceSideContent>
		</section>
	);
}
