"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type Delivery,
	type DeliveryFile,
	deliveryDraftSchema,
	versionLabel,
} from "@/lib/deliveries";
import { api, ApiError } from "./api";
import { useApiRevalidation } from "./use-api-revalidation";
import { useProjectUpdates } from "./project-live";
import { useIssueWrite } from "./use-issue-write";
import { UploadQueue } from "./upload-queue";
import { DeliveryHistory } from "./delivery-history";
import { DeliveryContents, deliverySizeLabel as sizeLabel } from "./delivery-version";
import "./delivery-section.css";
import { useProjectReadOnly } from "./project-read-only";
type Props = {
	active?: boolean;
	base: string;
	guest: boolean;
	onInvalid: () => void;
	onDirty: (value: boolean) => void;
};
export function DeliverySection({ base, guest, onInvalid, onDirty, active: visible = true }: Props) {
	const archived = useProjectReadOnly();
	const [published, setPublished] = useState<Delivery | null>(null),
		[drafts, setDrafts] = useState<Delivery[]>([]),
		[active, setActive] = useState<Delivery | null>(null),
		[editing, setEditing] = useState(false),
		[loading, setLoading] = useState(true),
		[formVersion, setFormVersion] = useState(0),
		[error, setError] = useState(""),
		[notice, setNotice] = useState("");
	const feedbackDirty = useRef(new Set<string>());
	const initialized = useRef(false);
	const publishedId = useRef<string | null>(null);
	publishedId.current = published?.id ?? null;
	const [newerVersion, setNewerVersion] = useState(false);
	const dirty = useRef(false),
		loadRun = useRef(0),
		callbacks = useRef({ onInvalid, onDirty });
	callbacks.current = { onInvalid, onDirty };
	const reading = useRef<AbortController | null>(null);
	const handleDirty = useCallback((value: boolean) => {
		dirty.current = value;
		callbacks.current.onDirty(value || feedbackDirty.current.size > 0);
	}, []);
	const onFeedbackDirty = useCallback((id: string, value: boolean) => {
		if (value) feedbackDirty.current.add(id); else feedbackDirty.current.delete(id);
		callbacks.current.onDirty(dirty.current || feedbackDirty.current.size > 0);
	}, []);
	const allowFeedbackLeave = useCallback((id: string) => !feedbackDirty.current.has(id) || window.confirm("该版本有尚未提交或结果未确认的反馈，放弃本页输入并离开？"), []);
	const load = useCallback(async (reset = false) => {
		const run = ++loadRun.current;
		reading.current?.abort();
		const controller = new AbortController();
		reading.current = controller;
		if (reset) setLoading(true);
		setError("");
		try {
			const data = await api<{
				published: Delivery | null;
				drafts: Delivery[];
			}>(`${base}/deliveries`, "GET", undefined, { signal: controller.signal, refresh: reset });
			if (run !== loadRun.current) return;
			if (publishedId.current && feedbackDirty.current.size > 0 && data.published?.id !== publishedId.current) {
				setNewerVersion(true);
				setNotice("已有新版本发布；当前版本的留言已保留，提交完成后可查看最新版。");
			} else { setPublished(data.published); setNewerVersion(false); }
			setDrafts(data.drafts);
            if (!dirty.current) {
              if (!initialized.current || reset) {
                setActive(old => data.drafts.find(d => d.id === old?.id) ?? data.drafts[0] ?? null);
                setEditing(!guest && (!data.published || data.drafts.length > 0));
              } else setActive(old => old ? data.drafts.find(d => d.id === old.id) ?? old : null);
            } else setNotice("交付已在别处更新；当前输入已保留，保存时检查冲突。");
			initialized.current = true;
		} catch (e) {
			if (run !== loadRun.current) return;
			if (e instanceof ApiError && e.status === 401)
				callbacks.current.onInvalid();
			setError(e instanceof Error ? e.message : "读取交付失败。");
		} finally {
			if (run === loadRun.current) setLoading(false);
		}
	}, [base, guest]);
	useEffect(() => {
		if (!visible) return;
		const timer = setTimeout(() => void load(), 500);
		return () => { clearTimeout(timer); loadRun.current++; reading.current?.abort(); };
	}, [load, visible]);
	useEffect(() => () => callbacks.current.onDirty(false), []);
	useApiRevalidation(() => { if (visible && !dirty.current) void load(); });
 useProjectUpdates(updates => {
  if (visible && updates.some(e => e.kind === "delivery.changed" || e.kind === "resync")) void load();
 });

	function allowLeave() {
		return (
			(!dirty.current && !feedbackDirty.current.size) ||
			window.confirm("有尚未保存的交付输入或未提交的反馈，放弃本页输入并重新载入？")
		);
	}
	function refresh() {
		if (allowLeave()) { feedbackDirty.current.clear(); handleDirty(false); setFormVersion(v => v + 1); void load(true); }
	}
	function saved(d: Delivery) {
		loadRun.current++;
		setLoading(false);
		setNotice("交付草稿已保存，仅工程师可见。");
		setActive(d);
		setDrafts((old) => [d, ...old.filter((x) => x.id !== d.id)]);
	}
	function released(d: Delivery) {
		loadRun.current++;
		setLoading(false);
		setNotice(`${versionLabel(d.versionNo ?? 1)} 已发布，客户可下载。`);
		setPublished(d);
		setDrafts((old) => old.filter((x) => x.id !== d.id));
		setActive(null);
		setEditing(false);
		handleDirty(false);
	}
	return (
		<section className="delivery-section" aria-label="成果交付">
			{guest || published || drafts.length > 0 ? (
				<div className="detail-heading">
					<h2>成果交付</h2>

				</div>
			) : null}
			{loading ? <p role="status">读取交付与草稿…</p> : null}
			{error ? (
				<p role="alert" className="error">
					{error}
					<button type="button" onClick={refresh}>
						重试读取交付
					</button>
				</p>
			) : null}
			{notice ? <p role="status">{notice}</p> : null}
			{guest && !loading && !error && !published ? (
				<p className="empty">暂无交付</p>
			) : null}
			{published ? (
				<section className="published-delivery" aria-label="已发布成果">
					<h3>{newerVersion ? "正在查看版本" : "最新版本"} {versionLabel(published.versionNo ?? 1)}</h3>
					{newerVersion ? <button type="button" onClick={refresh}>查看最新版本</button> : null}
					<p>
						工程师发布 ·{" "}
						{new Date(
							published.publishedAt ?? published.createdAt,
						).toLocaleString("zh-CN")} · {published.files.length}份附件
					</p>
					<DeliveryContents key={`${published.id}:${formVersion}`} delivery={published} base={base} guest={guest} visible={visible} onInvalid={onInvalid} onFeedbackDirty={onFeedbackDirty} />
				</section>
			) : null}
			{published ? <DeliveryHistory key={`${base}:${published.id}:${formVersion}`} base={base} beforeVersion={published.versionNo ?? 1} visible={visible} guest={guest} onInvalid={onInvalid} onFeedbackDirty={onFeedbackDirty} allowFeedbackLeave={allowFeedbackLeave} /> : null}
			{!guest && (!loading || editing) ? (
				<>
					{drafts.length > 1 ? (
						<div className="actions">
							{drafts.map((d, n) => (
								<button
									type="button"
									key={d.id}
									onClick={() => {
										if (allowLeave()) {
											setActive(d);
											setEditing(true);
										}
									}}
								>
									编辑草稿 {n + 1}
								</button>
							))}
						</div>
					) : null}
					{!editing ? (
						<button
							type="button"
							disabled={archived}
							onClick={() => {
								setActive(drafts[0] ?? null);
								setEditing(true);
							}}
						>
							{drafts.length ? "继续编辑交付草稿" : "准备下一次成果"}
						</button>
					) : null}
					{editing ? (
						<DeliveryEditor
							key={`${active?.id ?? "new"}:${active?.revision ?? 0}:${formVersion}`}
							base={base}
							draft={active}
							onSaved={saved}
							onPublished={released}
							onInvalid={onInvalid}
							onDirty={handleDirty}
							onReload={refresh}
						/>
					) : null}
				</>
			) : null}
		</section>
	);
}
function DeliveryEditor({
	base,
	draft,
	onSaved,
	onPublished,
	onInvalid,
	onDirty,
	onReload,
}: {
	base: string;
	draft: Delivery | null;
	onSaved: (d: Delivery) => void;
	onPublished: (d: Delivery) => void;
	onInvalid: () => void;
	onDirty: (value: boolean) => void;
	onReload: () => void;
}) {
	const [description, setDescription] = useState(draft?.description ?? ""),
		[selected, setSelected] = useState<string[]>(
			draft?.files.map((f) => f.id) ?? [],
		),
		[files, setFiles] = useState<DeliveryFile[]>([]),
		[cursor, setCursor] = useState<string | null>(null),
		[fileError, setFileError] = useState("");
	const changes = useRef({ save: false, publish: false }),
		generation = useRef(0),
		invalidRef = useRef(onInvalid);
	invalidRef.current = onInvalid;
	const saveDirty = useCallback(
		(value: boolean) => {
			changes.current.save = value;
			onDirty(value || changes.current.publish);
		},
		[onDirty],
	);
	const publishDirty = useCallback(
		(value: boolean) => {
			changes.current.publish = value;
			onDirty(value || changes.current.save);
		},
		[onDirty],
	);
	const save = useIssueWrite<Delivery>(
		`${base}/deliveries${draft ? `/${draft.id}` : ""}`,
		draft?.revision,
		onSaved,
		onInvalid,
		saveDirty,
		draft ? "PATCH" : "POST",
	);
	const publish = useIssueWrite<Delivery>(
		`${base}/deliveries/${draft?.id}/publish`,
		draft?.revision,
		onPublished,
		onInvalid,
		publishDirty,
	);
	const loadFiles = useCallback(
		async (next: string | null = null) => {
			const run = ++generation.current;
			try {
				const data = await api<{
					items: DeliveryFile[];
					nextCursor: string | null;
				}>(`${base}/files?purpose=delivery${next ? `&cursor=${next}` : ""}`);
				if (run !== generation.current) return;
				setFiles((old) => (next ? [...old, ...data.items] : data.items));
				setCursor(data.nextCursor);
				setFileError("");
			} catch (e) {
				if (run !== generation.current) return;
				if (e instanceof ApiError && e.status === 401) invalidRef.current();
				setFileError(e instanceof Error ? e.message : "读取成果附件失败。");
			}
		},
		[base],
	);
	const refreshFiles = useCallback(() => void loadFiles(), [loadFiles]);
	useEffect(() => {
		void loadFiles();
		return () => {
			generation.current++;
		};
	}, [loadFiles]);
 useProjectUpdates(updates => { if (updates.some(e => e.kind === "file.changed" || e.kind === "resync")) void loadFiles(); });

	const value = { description, fileIds: selected },
		blocked = save.disabled || publish.disabled;
	const availableFiles = [
		...new Map(
			[...(draft?.files ?? []), ...files].map((file) => [file.id, file]),
		).values(),
	];
	// Preserve an existing text-only draft; new empty deliveries start with upload only.
	const hasContent = availableFiles.length > 0 || !!draft?.description;
	return (
		<section className="delivery-editor" aria-label="交付草稿">
			{hasContent ? <h3>交付草稿 <small>仅工程师可见</small></h3> : null}
			<UploadQueue
				base={base}
				purpose="delivery"
				compact
				emptyHint={hasContent ? undefined : "上传文件，开始交付"}
				onReady={refreshFiles}
				onInvalid={onInvalid}
			/>
			{fileError ? (
				<p role="alert" className="error">
					{fileError}
					<button type="button" onClick={refreshFiles}>
						重试
					</button>
				</p>
			) : null}
			<div
				className="delivery-composer"
				data-open={hasContent}
				aria-hidden={!hasContent}
				inert={!hasContent}
			>
				<div className="delivery-composer-inner">
					<form
						aria-label="保存交付草稿"
						onSubmit={(e) => {
							e.preventDefault();
							const parsed = deliveryDraftSchema.safeParse(value);
							if (!parsed.success) {
								save.setError("说明最多4000字，成果文件最多20份且不能重复。");
								return;
							}
							void save.submit(parsed.data);
						}}
					>
						<fieldset disabled={blocked}>
							<label>
								交付说明
								<textarea
									aria-label="交付说明"
									maxLength={4000}
									value={description}
									onChange={(e) => {
										setDescription(e.target.value);
										save.changed();
									}}
								/>
							</label>
							<h4>成果文件 · {selected.length}/20</h4>
							<div className="evidence-pick-list">
								{availableFiles.map((file) => (
									<label key={file.id}>
										<input
											type="checkbox"
											checked={selected.includes(file.id)}
											disabled={
												!selected.includes(file.id) && selected.length >= 20
											}
											onChange={(e) => {
												setSelected((old) =>
													e.target.checked
														? [...old, file.id]
														: old.filter((id) => id !== file.id),
												);
												save.changed();
											}}
										/>
										{file.filename} · {sizeLabel(file.byteSize)}
									</label>
								))}
							</div>
							{cursor ? (
								<button type="button" onClick={() => void loadFiles(cursor)}>
									更多成果附件
								</button>
							) : null}
						</fieldset>
						<button
							type="submit"
							disabled={
								save.readOnly || save.busy || save.conflict || publish.busy || publish.blocked
							}
						>
							{save.busy
								? "保存中…"
								: save.blocked
									? "重试保存草稿"
									: "保存交付草稿"}
						</button>
					</form>
					<p role="status">{save.status}</p>
					{save.error ? (
						<p role="alert" className="error">
							{save.error}
						</p>
					) : null}
					{draft ? (
						<div className="delivery-publish">
							<button
								type="button"
								className="primary"
								disabled={
									save.readOnly || save.dirty ||
									save.busy ||
									save.blocked ||
									publish.busy ||
									publish.conflict ||
									!draft.files.length
								}
								onClick={() => {
									if (
										publish.blocked ||
										window.confirm(
											`确认向客户发布以下成果？\n${draft.files.map((f) => f.filename).join("\n")}\n说明：${draft.description || "无"}\n发布后不能覆盖原集合。`,
										)
									)
										void publish.submit({});
								}}
							>
								{publish.busy
									? "正在发布…"
									: publish.blocked
										? "重试发布成果"
										: "确认发布成果"}
							</button>
							{save.dirty ? <p>有未保存修改，请先保存草稿。</p> : null}
							<p role="status">{publish.status}</p>
							{publish.error ? (
								<p role="alert" className="error">
									{publish.error}
								</p>
							) : null}
						</div>
					) : null}
					{save.blocked || publish.blocked ? (
						<div className="save-recovery">
							<p>
								输入已保留；未知结果重试沿用原幂等键。冲突时复制草稿，再重新载入。
							</p>
							<button
								type="button"
								onClick={async () => {
									try {
										await navigator.clipboard.writeText(
											JSON.stringify(value, null, 2),
										);
										save.setError("草稿已复制，请妥善保存。");
									} catch {
										save.setError("复制未完成，请保留本页。");
									}
								}}
							>
								复制交付草稿
							</button>
							<button type="button" onClick={onReload}>
								重新载入交付
							</button>
						</div>
					) : null}
				</div>
			</div>
		</section>
	);
}
