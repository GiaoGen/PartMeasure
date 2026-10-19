"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type AnnotationDraft,
	type Geometry,
	type EngineeringMetadata,
	emptyMetadata,
	typeLabel,
	validateAnnotation,
} from "@/lib/annotations";
import { api, ApiError, message } from "./api";
import { useAnnotationSession } from "./use-annotation-session";
import { EngineeringFields } from "./engineering-fields";
import { WorkspaceSideContent } from "./workspace-side-content";
import { AnnotationReminders } from "./annotation-reminders";
import { FileIssues } from "./file-issues";
import { MeasurementCreate } from "./measurement-create";
const Canvas = dynamic(() => import("./annotation-canvas"), {
	ssr: false,
	loading: () => <p role="status">载入画布…</p>,
});
type Revision = {
	revision: number;
	geometry: Geometry;
	metadata: EngineeringMetadata;
	deleted: boolean;
	createdAt: string;
};
export function AnnotationEditor({
	base,
	fileId,
	guest,
	onInvalid,
	onDirty,
	onIssueCreated,
	onOpenIssue,
	onAnnotationsSaved,
	refreshKey = 0,
	initialAnnotationId,
	propertiesOnly = false,
	panelHidden = false,
	onOpenProperties,
	onInitialIssue,
}: {
	base: string;
	fileId: string;
	guest: boolean;
	onInvalid: () => void;
	onDirty: (dirty: boolean) => void;
	onIssueCreated: () => void;
	onOpenIssue: (id: string) => void;
	onAnnotationsSaved?: () => void;
	refreshKey?: number;
	initialAnnotationId?: string | undefined;
	propertiesOnly?: boolean;
	panelHidden?: boolean;
	onOpenProperties?: () => boolean;
	onInitialIssue?: (id: string) => void;
}) {
	const changes = useRef({ annotation: false, request: false, comment: false });
	const [requestDirty, setRequestDirty] = useState(false);
	const [remindersMounted, setRemindersMounted] = useState(guest);
	const [fileIssuesMounted, setFileIssuesMounted] = useState(false);
	const onAnnotationDirty = useCallback(
		(dirty: boolean) => {
			changes.current.annotation = dirty;
			onDirty(dirty || changes.current.request || changes.current.comment);
		},
		[onDirty],
	);
	const onRequestDirty = useCallback(
		(dirty: boolean) => {
			changes.current.request = dirty;
			setRequestDirty(dirty);
			onDirty(dirty || changes.current.annotation || changes.current.comment);
		},
		[onDirty],
	);
	const onFileIssueDirty = useCallback(
		(dirty: boolean) => {
			changes.current.comment = dirty;
			onDirty(dirty || changes.current.annotation || changes.current.request);
		},
		[onDirty],
	);
	const session = useAnnotationSession(
		base,
		fileId,
		guest,
		onInvalid,
		onAnnotationDirty,
	);
	const initialSelection = useRef("");
	useEffect(() => {
		if (
			!initialAnnotationId ||
			session.loading ||
			initialSelection.current === initialAnnotationId
		)
			return;
		initialSelection.current = initialAnnotationId;
		if (session.items.some((item) => item.id === initialAnnotationId))
			session.setSelected(initialAnnotationId);
		else session.setError("标注已不可用，请重新选择。");
	}, [
		initialAnnotationId,
		session.loading,
		session.items,
		session.setSelected,
		session.setError,
	]);
	const [history, setHistory] = useState<Revision[]>([]),
		[historyId, setHistoryId] = useState<string | null>(null),
		[before, setBefore] = useState<number | null>(null),
		[historyLoading, setHistoryLoading] = useState(false),
		[preview, setPreview] = useState<(Revision & { id: string }) | null>(null),
		[notice, setNotice] = useState("");
	const historyRun = useRef(0);
	const selected = session.items.find((i) => i.id === session.selected) ?? null;
	const editDisabled =
		session.saving || session.blocked || !!preview || requestDirty;
	async function save() {
		const heads = await session.save();
		if (heads) onAnnotationsSaved?.();
		return heads;
	}
	function select(id: string | null) {
		if (
			id !== session.selected &&
			changes.current.request &&
			!window.confirm("测量提醒尚未发送，切换标注会放弃输入。继续？")
		)
			return;
		if (id && onOpenProperties?.() === false) return;
		session.setSelected(id);
		setPreview(null);
		setHistory([]);
		setHistoryId(null);
		setHistoryLoading(false);
		historyRun.current++;
	}
	function remove() {
		if (guest || editDisabled || !selected) return;
		if (
			changes.current.request &&
			!window.confirm("测量提醒尚未发送，删除标注会放弃请求输入。继续？")
		)
			return;
		session.change(session.items.filter((i) => i.id !== selected.id));
		select(null);
	}
	async function loadHistory(id: string, next: number | null = null) {
		const run = ++historyRun.current;
		setHistoryLoading(true);
		try {
			const result = await api<{
				items: Revision[];
				nextBefore: number | null;
			}>(`${base}/annotations/${id}/revisions${next ? `?before=${next}` : ""}`);
			if (run !== historyRun.current) return;
			setHistory((old) => (next ? [...old, ...result.items] : result.items));
			setBefore(result.nextBefore);
			setHistoryId(id);
		} catch (e) {
			if (e instanceof ApiError && e.status === 401) onInvalid();
			session.setError(e instanceof Error ? e.message : "读取修订失败。");
		} finally {
			if (run === historyRun.current) setHistoryLoading(false);
		}
	}
	if (session.loading)
		return (
			<WorkspaceSideContent>
				<section className="editor-loading">
					<p role="status">读取标注和图片记录…</p>
				</section>
			</WorkspaceSideContent>
		);
	if (!session.document)
		return (
			<WorkspaceSideContent>
				<section>
					<p role="alert" className="error">
						{session.error || "无法读取标注。"}
					</p>
					<button type="button" onClick={() => void session.load()}>
						重试载入标注
					</button>
				</section>
			</WorkspaceSideContent>
		);
	const { image } = session.document;
	const shown = preview
		? session.items.some((i) => i.id === preview.id)
			? session.items.map((i) =>
					i.id === preview.id
						? {
								id: i.id,
								geometry: preview.geometry,
								metadata: preview.metadata,
							}
						: i,
				)
			: [
					...session.items,
					{
						id: preview.id,
						geometry: preview.geometry,
						metadata: preview.metadata,
					},
				]
		: session.items;
	const detail: AnnotationDraft | null = preview
		? { id: preview.id, geometry: preview.geometry, metadata: preview.metadata }
		: selected;
	return (
		<div
			data-properties-only={propertiesOnly}
			className={`annotation-editor ${guest ? "read-only-editor" : ""}`}
		>
			{!propertiesOnly ? (
				<Canvas
					image={image}
					src={`${base}/files/${fileId}/preview`}
					items={shown}
					selected={preview?.id ?? session.selected}
					guest={guest}
					disabled={editDisabled}
					canUndo={session.canUndo}
					canRedo={session.canRedo}
					onSelect={select}
					onCreate={(geometry) => {
						if (guest || editDisabled) return;
						try {
							validateAnnotation(
								geometry,
								emptyMetadata(),
								image.width,
								image.height,
							);
							if (
								session.items.length +
									session.heads.filter((h) => h.deleted).length >=
								200
							) {
								session.setError(message("ANNOTATION_LIMIT"));
								return;
							}
							const item = {
								id: crypto.randomUUID(),
								geometry,
								metadata: emptyMetadata(),
							};
							session.change([...session.items, item]);
							select(item.id);
						} catch (e) {
							session.setError(
								message(e instanceof Error ? e.message : "INVALID_GEOMETRY"),
							);
						}
					}}
					onChange={(item) => session.update(item)}
					onDelete={remove}
					onUndo={session.undo}
					onRedo={session.redo}
					onSave={() => void save()}
					onError={session.setError}
					onInvalid={onInvalid}
				/>
			) : null}
			<WorkspaceSideContent>
				<aside
					hidden={panelHidden}
					className="annotation-properties"
					aria-label="标注属性与列表"
				>
					{" "}
					<div className="editor-status">
						<p role="status">
							{preview
								? `正在查看历史修订 #${preview.revision}，不会修改当前标注`
								: session.status}
							{!guest && session.dirty && !session.saving ? " · 未保存" : ""}
						</p>
						{preview ? (
							<button type="button" onClick={() => setPreview(null)}>
								返回当前标注
							</button>
						) : null}
						{session.error ? (
							<p role="alert" className="error">
								{session.error}
							</p>
						) : null}
						{session.blocked ? (
							<div className="save-recovery">
								<p>
									{session.conflict
										? "其他页面可能已更新，请先保留草稿再重新载入；不会自动覆盖。"
										: "请求结果可能尚未确认；重试会沿用同一幂等键，编辑暂时暂停。"}
								</p>
								<button
									type="button"
									onClick={async () => {
										try {
											await navigator.clipboard.writeText(
												JSON.stringify(
													{
														fileId,
														imageHash: image.imageHash,
														annotations: session.items,
													},
													null,
													2,
												),
											);
											setNotice("草稿已复制，请妥善保存。");
										} catch {
											setNotice("无法自动复制，请保留本页并重试。");
										}
									}}
								>
									复制当前草稿
								</button>
								<button
									type="button"
									onClick={() => {
										if (
											window.confirm("重新载入将放弃本页未保存的修改，继续？")
										)
												void session.load(true);
									}}
								>
									重新载入已保存版本
								</button>
							</div>
						) : null}
						<p role="status">{notice}</p>
					</div>
					<h3>{guest ? "测量提醒与回复" : "标注与属性"}</h3>
					{!guest ? (
						<div className="actions">
							<button
								type="button"
								disabled={
									session.saving ||
									session.conflict ||
									!!preview ||
									(!session.dirty && !session.blocked)
								}
								onClick={() => void save()}
							>
								{session.saving
									? "保存中…"
									: session.blocked
										? "重试保存"
										: "保存标注"}
							</button>
						</div>
					) : null}
					{!session.items.length ? (
						<p>{guest ? "暂无标注" : "选择工具，在图上标注。"}</p>
					) : null}
					<ol className="annotation-list">
						{session.items.map((item, index) => (
							<li key={item.id}>
								<button
									type="button"
									aria-pressed={session.selected === item.id && !preview}
									onClick={() => select(item.id)}
								>
									<span className="annotation-number">{index + 1}</span>
									{item.metadata.name || typeLabel(item.geometry)}
									{item.metadata.dimension
										? ` · ${item.metadata.dimension} ${item.metadata.unit}`
										: ""}
								</button>
							</li>
						))}
					</ol>
					{detail ? (
						<>
							{!guest ? (
								<EngineeringFields
									item={detail}
									disabled={editDisabled}
									onChange={session.update}
									onBlur={session.endEdit}
								/>
							) : (
								<div className="annotation-readout">
									<h4>{detail.metadata.name || typeLabel(detail.geometry)}</h4>
									{detail.geometry.type === "text" ? (
										<p>{detail.geometry.text}</p>
									) : null}
									{detail.metadata.dimension ? (
										<p>
											人工
											{detail.geometry.type === "circle"
												? detail.metadata.circleMeasure === "diameter"
													? "直径"
													: "半径"
												: "尺寸"}
											：{detail.metadata.dimension} {detail.metadata.unit}
										</p>
									) : null}
									{detail.metadata.holeDepth ? (
										<p>
											孔深：{detail.metadata.holeDepth} {detail.metadata.unit}
										</p>
									) : null}
									{detail.metadata.holeType ? (
										<p>
											孔类型：
											{
												{
													through: "通孔",
													blind: "盲孔",
													threaded: "螺纹孔",
													counterbore: "柱形沉孔",
													countersink: "锥形沉孔",
													other: "其他",
												}[detail.metadata.holeType]
											}
										</p>
									) : null}
									{detail.metadata.thread ? (
										<p>螺纹：{detail.metadata.thread}</p>
									) : null}
									<p>{detail.metadata.notes}</p>
								</div>
							)}
							{!guest && selected && !preview ? (
								<div className="actions">
									<button
										type="button"
										className="danger"
										disabled={editDisabled}
										onClick={remove}
									>
										删除选中标注
									</button>
									<button
										type="button"
										disabled={
											session.dirty ||
											session.saving ||
											!session.heads.some((h) => h.id === selected.id)
										}
										onClick={() => void loadHistory(selected.id)}
									>
										修订历史
									</button>
								</div>
							) : null}
							{!guest && selected && !preview ? (
								<MeasurementCreate
									key={selected.id}
									base={base}
									fileId={fileId}
									annotation={selected}
									prepare={async () => {
										const heads = await save();
										return heads?.find(
											(h) => h.id === selected.id && !h.deleted,
										);
									}}
									onCreated={onIssueCreated}
									onInvalid={onInvalid}
									onDirty={onRequestDirty}
									disabled={session.saving || session.conflict || !!preview}
								/>
							) : null}
						</>
					) : null}
					{!guest && session.heads.some((h) => h.deleted) ? (
						<details>
							<summary>
								已隐藏的标注（{session.heads.filter((h) => h.deleted).length}）
							</summary>
							{session.heads
								.filter((h) => h.deleted)
								.map((h) => (
									<p key={h.id}>
										{h.metadata.name || typeLabel(h.geometry)}{" "}
										<button
											type="button"
											disabled={requestDirty || session.dirty || session.saving}
											onClick={() => void loadHistory(h.id)}
										>
											查看修订
										</button>
									</p>
								))}
						</details>
					) : null}
					{historyLoading ? <p role="status">读取修订…</p> : null}
					{historyId ? (
						<section className="revision-list" aria-label="标注修订历史">
							<h4>保留的修订</h4>
							<ol>
								{history.map((r) => (
									<li key={r.revision}>
										<button
											type="button"
											disabled={requestDirty || session.dirty || session.saving}
											onClick={() => setPreview({ ...r, id: historyId })}
										>
											修订 #{r.revision} · {r.deleted ? "隐藏" : "保存"} ·{" "}
											{r.metadata.name || typeLabel(r.geometry)}
										</button>
										<small>
											{new Date(r.createdAt).toLocaleString("zh-CN")}
										</small>
									</li>
								))}
							</ol>
							{before ? (
								<button
									type="button"
									disabled={historyLoading}
									onClick={() => void loadHistory(historyId, before)}
								>
									更早修订
								</button>
							) : null}
						</section>
					) : null}
					<details
						className="photo-reminders"
						open={guest}
						onToggle={(event) => {
							if (event.currentTarget.open) setRemindersMounted(true);
						}}
					>
						<summary>相关测量提醒</summary>{" "}
						{selected && remindersMounted ? (
							<AnnotationReminders
								key={selected.id}
								base={base}
								fileId={fileId}
								annotationId={selected.id}
								refreshKey={refreshKey}
								onOpen={onOpenIssue}
								onInitial={guest ? onInitialIssue : undefined}
								onInvalid={onInvalid}
							/>
						) : null}
					</details>
					<details
						className="photo-file-issues"
						onToggle={(event) => {
							if (event.currentTarget.open) setFileIssuesMounted(true);
						}}
					>
						<summary>这张照片的其他问题</summary>
						{fileIssuesMounted ? (
							<FileIssues
								key={fileId}
								base={base}
								fileId={fileId}
								guest={guest}
								refreshKey={refreshKey}
								onDirty={onFileIssueDirty}
								onInvalid={onInvalid}
								onOpen={onOpenIssue}
								onCreated={onIssueCreated}
							/>
						) : null}
					</details>
				</aside>
			</WorkspaceSideContent>
		</div>
	);
}
