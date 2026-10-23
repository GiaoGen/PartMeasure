"use client";
import { MeasurementHelp } from "./measurement-help";
import {
	displayUnit,
	measurementFieldLabel,
} from "@/lib/annotation-collaboration";
import dynamic from "next/dynamic";
import { EvidencePreview } from "./evidence-preview";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type IssueCurrent as Detail,
	type IssueWriteResult,
	applyIssueWrite,
	stateLabel,
	methodLabel,
} from "@/lib/issues";
import { ApiError, readCached, rememberApi } from "./api";
import { currentIssueUrl, readCurrentIssue } from "./interaction-reads";
import { useApiRevalidation } from "./use-api-revalidation";
import { useProjectUpdates } from "./project-live";
import { WorkspaceSideContent } from "./workspace-side-content";
import { IssueResponseForm } from "./issue-response-form";
import { IssueReviewForm } from "./issue-review-form";
import { IssueHistory, type MeasurementTarget } from "./issue-history";
import { MeasurementReplyContent } from "./measurement-reply-content";
import { IssueTargetPreview } from "./issue-target-preview";
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
	onOpenProperties,
	onViewPosition,
	backLabel,
	inbox = false,
	showTarget = true,
	onSnapshot,
	targetStatus,
	currentView,
	managedByInbox = false,
	onReadRequest,
}: {
	currentView?: Detail;
	managedByInbox?: boolean;
	onReadRequest?: (id: string) => void;
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
	onViewPosition?: (target: MeasurementTarget) => void;
	backLabel?: string;
	/** Task inbox keeps one fixed target above the existing reply UI. */
	inbox?: boolean;
	showTarget?: boolean;
	onSnapshot?: (issue: Detail) => void;
	targetStatus?: { pending: number; remeasure: number; submitted: number };
}) {
	const url = currentIssueUrl(base, id);
	const [issue, setIssue] = useState<Detail | null>(() => currentView ?? (managedByInbox ? null : readCached<Detail>(url)) ?? null),
		[loading, setLoading] = useState(!issue),
		[error, setError] = useState(""),
		[formVersion, setFormVersion] = useState(0),
		[canvasError, setCanvasError] = useState("");
	const [targetExpanded, setTargetExpanded] = useState(false);
	const [committedPending, setCommittedPending] = useState(false),
		[savedNotice, setSavedNotice] = useState("");
	const generation = useRef(0),
		dirty = useRef(false),
		callbacks = useRef({ onInvalid, onUpdated, onSnapshot, onReadRequest, onDirty });
	callbacks.current = { onInvalid, onUpdated, onSnapshot, onReadRequest, onDirty };
	const reading = useRef<AbortController | null>(null);
	const activeRead = useRef(false);
	const issueRef = useRef(issue);
	issueRef.current = issue;
	const handleDirty = useCallback(
		(value: boolean) => {
			dirty.current = value;
			onDirty(value);
		},
		[onDirty],
	);
	const load = useCallback(
		async (reset = false) => {
			if (callbacks.current.onReadRequest) {
				if (reset) { dirty.current = false; callbacks.current.onDirty(false); setFormVersion(v => v + 1); }
				callbacks.current.onReadRequest(id);
				return;
			}
			if (!reset && activeRead.current && !reading.current?.signal.aborted) return;
			activeRead.current = true;
			const run = ++generation.current;
			reading.current?.abort();
			const controller = new AbortController();
			reading.current = controller;
			try {
				const data = await readCurrentIssue(base, id, { refresh: reset, signal: controller.signal });
				if (run !== generation.current || controller.signal.aborted) return;
				if (dirty.current && !reset) {
					setSavedNotice("对方已更新；当前输入已保留，提交时检查修订冲突。");
					return;
				}
				setIssue(data);
				callbacks.current.onSnapshot?.(data);
				setCommittedPending(false);
				setError("");
				if (reset) setFormVersion((v) => v + 1);
			} catch (e) {
				if (run !== generation.current || controller.signal.aborted) return;
				if (e instanceof ApiError && e.status === 401)
					callbacks.current.onInvalid();
				setError(e instanceof Error ? e.message : "无法读取任务。");
			} finally {
				if (run === generation.current) { activeRead.current = false; setLoading(false); }
			}
		},
		[base, id],
	);
	const managed = managedByInbox || !!currentView;
	useEffect(() => {
		if (!managed) void load();
		return () => {
			generation.current++;
			reading.current?.abort();
		};
	}, [load, managed]);
	useEffect(() => {
		if (!currentView) return;
		if (dirty.current) {
			if (currentView.revision > (issueRef.current?.revision ?? 0)) setSavedNotice("对方已更新；当前输入已保留，提交时检查修订冲突。");
			return;
		}
		setIssue(previous => previous && previous.revision > currentView.revision ? previous : currentView);
		setLoading(false);
		setCommittedPending(false);
	}, [currentView]);
	useApiRevalidation(() => { if (!managed && !dirty.current) void load(); });
	useProjectUpdates((updates) => {
		if (managed) return;
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
		const cached = readCached<Detail>(url);
		if (updates.every(e => e.kind === "issue.changed" && e.entityId === id && e.revision !== null && cached && cached.revision >= e.revision && issue && issue.revision >= e.revision)) return;
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
			reading.current?.abort();
			const canonical = rememberApi(url, updated);
			setIssue(canonical);
			callbacks.current.onSnapshot?.(canonical);
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
				<p role="status">读取测量位置与当前补充状态…</p>
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
	const target = issue.target,
		lastReview = issue.reviews.at(-1);
	const canReply =
		!issue.closedAt &&
		(issue.state === "awaiting_response" ||
			issue.state === "remeasure_requested");
	const historyContent = <IssueHistory issue={issue} base={base} />;
	if (inbox || (inline && issue.kind === "measurement"))
		return (
			<>
				{inbox && showTarget && target ? (
					<IssueTargetPreview
						key={`${base}:${issue.fileId}:${target.image.imageHash}`}
						base={base}
						issue={issue}
						image={target.image}
						{...(targetStatus ? { status: targetStatus } : {})}
						onInvalid={onInvalid}
					/>
				) : inbox && showTarget && !target ? (
					<p className="task-file-download">
						<a href={`${base}/files/${issue.fileId}/download`}>
							下载 {issue.file.filename}
						</a>
					</p>
				) : null}
				{savedNotice ? <p role="status">{savedNotice}</p> : null}
				{error ? (
					<p role="alert" className="error">
						{error}
						<button type="button" onClick={reload}>
							重试
						</button>
					</p>
				) : null}
				<MeasurementReplyContent
					showGuidance={inbox}
					issue={issue}
					base={base}
					guest={guest}
					committedPending={committedPending}
					formVersion={formVersion}
					onSaved={saved}
					onInvalid={onInvalid}
					onDirty={handleDirty}
					onReload={reload}
					{...(onViewPosition ? { onViewPosition } : {})}
				/>
			</>
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
						<>
							<p>建议使用：{methodLabel[issue.measurementMethod]}</p>
							{canReply ? <MeasurementHelp key={issue.id} method={issue.measurementMethod} field={issue.measurementField} /> : null}
						</>
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
