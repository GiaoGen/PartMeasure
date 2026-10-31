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
import {
	DeliveryContents,
	deliverySizeLabel as sizeLabel,
} from "./delivery-version";
import "./delivery-section.css";
import { useProductConfirm } from "./product-confirm";
import { WorkspaceIcon } from "./workspace-ui";
import { useProjectReadOnly } from "./project-read-only";
type Props = {
	active?: boolean;
	base: string;
	guest: boolean;
	onInvalid: () => void;
	onDirty: (value: boolean) => void;
};
export function DeliverySection({
	base,
	guest,
	onInvalid,
	onDirty,
	active: visible = true,
}: Props) {
	const archived = useProjectReadOnly();
	const confirm = useProductConfirm(visible ? "visible" : "hidden");
	const composerTarget = useRef<HTMLElement>(null);
	const latestHeading = useRef<HTMLHeadingElement>(null);
	const [editorSession, setEditorSession] = useState(0);
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
		if (value) feedbackDirty.current.add(id);
		else feedbackDirty.current.delete(id);
		callbacks.current.onDirty(dirty.current || feedbackDirty.current.size > 0);
	}, []);
	const allowFeedbackLeave = useCallback(
		async (id: string) =>
			!feedbackDirty.current.has(id) ||
			(await confirm({
				title: "关闭当前版本内容？",
				description:
					"本版有未提交的反馈或尚未完成的下载/打包。离开会关闭当前内容，已提交的历史仍保留。",
				cancelLabel: "继续处理",
				confirmLabel: "放弃并继续",
				danger: true,
			})),
		[confirm],
	);
	const load = useCallback(
		async (reset = false) => {
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
				}>(`${base}/deliveries`, "GET", undefined, {
					signal: controller.signal,
					refresh: reset,
				});
				if (run !== loadRun.current) return;
				if (
					publishedId.current &&
					feedbackDirty.current.size > 0 &&
					data.published?.id !== publishedId.current
				) {
					setNewerVersion(true);
					setNotice(
						"已有新版本发布；当前版本的输入与传输已保留，处理完成后可查看最新版。",
					);
				} else {
					setPublished(data.published);
					setNewerVersion(false);
				}
				setDrafts(data.drafts);
				if (!dirty.current) {
					if (!initialized.current || reset) {
						setActive(
							(old) =>
								data.drafts.find((d) => d.id === old?.id) ??
								data.drafts[0] ??
								null,
						);
						setEditing(!guest && (!data.published || data.drafts.length > 0));
					} else
						setActive((old) =>
							old ? (data.drafts.find((d) => d.id === old.id) ?? old) : null,
						);
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
		},
		[base, guest],
	);
	useEffect(() => {
		if (!visible) return;
		void load();
		return () => {
			loadRun.current++;
			reading.current?.abort();
		};
	}, [load, visible]);
	useEffect(() => () => callbacks.current.onDirty(false), []);
	useApiRevalidation(() => {
		if (visible && !dirty.current) void load();
	});
	useProjectUpdates((updates) => {
		if (
			visible &&
			updates.some((e) => e.kind === "delivery.changed" || e.kind === "resync")
		)
			void load();
	});

	async function allowLeave() {
		return (
			(!dirty.current && !feedbackDirty.current.size) ||
			(await confirm({
				title: "放弃当前交付输入？",
				description:
					"未保存的草稿、未提交的反馈或尚未完成的传输将被关闭。已发出的请求可能仍完成。",
				cancelLabel: "继续编辑",
				confirmLabel: "放弃并继续",
				danger: true,
			}))
		);
	}
	async function refresh() {
		if (await allowLeave()) {
			feedbackDirty.current.clear();
			handleDirty(false);
			setFormVersion((v) => v + 1);
			void load(true);
		}
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
		requestAnimationFrame(() => {
			latestHeading.current?.focus({ preventScroll: true });
			latestHeading.current?.scrollIntoView({
				block: "nearest",
				behavior: "instant",
			});
		});
	}

	function prepare() {
		if (archived) return;
		if (!editing) {
			setActive(drafts[0] ?? null);
			setEditing(true);
			setEditorSession((v) => v + 1);
		}
		requestAnimationFrame(() => {
			composerTarget.current?.scrollIntoView({
				block: "nearest",
				behavior: "instant",
			});
			composerTarget.current
				?.querySelector<HTMLElement>(".delivery-draft-heading")
				?.focus({ preventScroll: true });
		});
	}
	return (
		<section className="delivery-section" aria-label="交付与版本">
			<header className="delivery-page-heading">
				<div>
					<h2>交付与版本</h2>
				</div>
				{!guest ? (
					<button
						type="button"
						className="primary"
						disabled={
							archived ||
							(loading && !initialized.current) ||
							(!!error && !initialized.current)
						}
						onClick={prepare}
					>
						<span aria-hidden="true">＋</span>
						{editing
							? "编辑当前草稿"
							: drafts.length
								? "继续编辑草稿"
								: "准备新版本"}
					</button>
				) : null}
			</header>
			{error ? (
				<p role="alert" className="error pm-notice">
					{error}{" "}
					<button type="button" onClick={() => void refresh()}>
						重试读取交付
					</button>
				</p>
			) : null}
			{notice ? (
				<p role="status" className="pm-notice">
					{notice}
				</p>
			) : null}
			<div className="delivery-layout" data-guest={guest}>
				<div className="delivery-primary">
					{loading && !published ? (
						<div className="delivery-empty" role="status">
							<h3>正在读取交付…</h3>
							<p>正在准备已发布版本与附件。</p>
						</div>
					) : null}
					{loading && published ? (
						<p role="status" className="muted">
							正在更新交付，当前版本仍可查看。
						</p>
					) : null}
					{!loading && !error && !published ? (
						<section className="delivery-empty">
							<WorkspaceIcon kind="file" />
							<h3>尚未发布交付版本</h3>
							<p>
								{guest
									? "工程师发布成果后，可在这里查看附件、下载并反馈。"
									: "在草稿区准备成果附件，保存后发布给客户。"}
							</p>
						</section>
					) : null}
					{published ? (
						<section className="published-delivery" aria-label="已发布成果">
							<header className="delivery-version-heading">
								<div>
									<h3 ref={latestHeading} tabIndex={-1}>
										{versionLabel(published.versionNo ?? 1)}
									</h3>
									<p>
										发布于{" "}
										<time
											dateTime={published.publishedAt ?? published.createdAt}
										>
											{new Date(
												published.publishedAt ?? published.createdAt,
											).toLocaleString("zh-CN", { timeZone: "Asia/Taipei" })}
										</time>{" "}
										· 工程师 · {published.files.length} 份附件
									</p>
								</div>
								<span className="pm-status-label">
									{newerVersion ? "正在查看版本" : "最新版本"}
								</span>
							</header>
							{newerVersion ? (
								<p className="pm-notice">
									已有新版本；当前输入仍属于本版。{" "}
									<button type="button" onClick={() => void refresh()}>
										查看最新版本
									</button>
								</p>
							) : null}
							<DeliveryContents
								key={[published.id, formVersion].join(":")}
								delivery={published}
								base={base}
								guest={guest}
								visible={visible}
								onInvalid={onInvalid}
								onFeedbackDirty={onFeedbackDirty}
							/>
						</section>
					) : null}
				</div>
				<aside
					className="delivery-sidebar"
					aria-label={guest ? "历史版本" : "私有草稿与历史版本"}
				>
					{!guest && (!loading || editing) ? (
						<section
							ref={composerTarget}
							className="delivery-draft-card"
							aria-label="私有交付草稿"
						>
							<header className="delivery-draft-title">
								<h3 className="delivery-draft-heading" tabIndex={-1}>
									私有草稿
								</h3>
								<span className="pm-status-label" data-tone="neutral">
									仅工程师
								</span>
							</header>
							{archived ? <p className="delivery-draft-intro">已归档，草稿只读。</p> : null}
							{drafts.length > 1 ? (
								<fieldset className="delivery-draft-switches">
									<legend className="pm-sr-only">选择交付草稿</legend>
									{drafts.map((d, n) => (
										<button
											type="button"
											key={d.id}
											aria-pressed={editing && active?.id === d.id}
											onClick={async () => {
												if (active?.id === d.id && editing) return;
												if (await allowLeave()) {
													setActive(d);
													setEditing(true);
													setEditorSession((v) => v + 1);
												}
											}}
										>
											草稿 {n + 1}
										</button>
									))}
								</fieldset>
							) : null}
							{!editing ? (
								<button type="button" disabled={archived} onClick={prepare}>
									{drafts.length ? "编辑草稿" : "新建草稿"}
								</button>
							) : null}
							{editing ? (
								<DeliveryEditor
									key={[editorSession, formVersion].join(":")}
									base={base}
									draft={active}
									onSaved={saved}
									onPublished={released}
									onInvalid={onInvalid}
									onDirty={handleDirty}
									onReload={() => void refresh()}
									visible={visible}
								/>
							) : null}
						</section>
					) : null}
					{published ? (
						<DeliveryHistory
							key={[base, published.id, formVersion].join(":")}
							base={base}
							beforeVersion={published.versionNo ?? 1}
							visible={visible}
							guest={guest}
							onInvalid={onInvalid}
							onFeedbackDirty={onFeedbackDirty}
							allowFeedbackLeave={allowFeedbackLeave}
						/>
					) : null}
				</aside>
			</div>
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
	visible,
}: {
	base: string;
	draft: Delivery | null;
	onSaved: (d: Delivery) => void;
	onPublished: (d: Delivery) => void;
	onInvalid: () => void;
	onDirty: (value: boolean) => void;
	onReload: () => void;
	visible: boolean;
}) {
	const confirm = useProductConfirm();
	const [uploadBusy, setUploadBusy] = useState(false);
	const [filesBusy, setFilesBusy] = useState(false);
	const [copyNotice, setCopyNotice] = useState("");
	const [pickedFiles, setPickedFiles] = useState<DeliveryFile[]>(
		draft?.files ?? [],
	);
	const [description, setDescription] = useState(draft?.description ?? ""),
		[selected, setSelected] = useState<string[]>(
			draft?.files.map((f) => f.id) ?? [],
		),
		[files, setFiles] = useState<DeliveryFile[]>([]),
		[cursor, setCursor] = useState<string | null>(null),
		[fileError, setFileError] = useState("");
	const draftId = draft?.id,
		draftRevision = draft?.revision,
		draftDescription = draft?.description;
	const draftFiles = draft?.files;
	const draftFileIds = draftFiles?.map((file) => file.id).join(",") ?? "";
	const loadedDraft = useRef({ id: draftId, revision: draftRevision });
	useEffect(() => {
		if (
			loadedDraft.current.id === draftId &&
			loadedDraft.current.revision === draftRevision
		)
			return;
		loadedDraft.current = { id: draftId, revision: draftRevision };
		setDescription(draftDescription ?? "");
		setSelected(draftFileIds ? draftFileIds.split(",") : []);
		setPickedFiles(draftFiles ?? []);
	}, [draftId, draftRevision, draftDescription, draftFileIds, draftFiles]);
	const changes = useRef({ save: false, publish: false, upload: false }),
		generation = useRef(0),
		invalidRef = useRef(onInvalid);
	invalidRef.current = onInvalid;
	const saveDirty = useCallback(
		(value: boolean) => {
			changes.current.save = value;
			onDirty(value || changes.current.publish || changes.current.upload);
		},
		[onDirty],
	);
	const publishDirty = useCallback(
		(value: boolean) => {
			changes.current.publish = value;
			onDirty(value || changes.current.save || changes.current.upload);
		},
		[onDirty],
	);
	const uploadChanged = useCallback(
		(value: boolean) => {
			changes.current.upload = value;
			onDirty(value || changes.current.save || changes.current.publish);
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
	const visibleFiles = useRef(visible);
	visibleFiles.current = visible;
	const filesChanged = useRef(true);
	const fileRead = useRef<AbortController | null>(null);
	const loadFiles = useCallback(
		async (next: string | null = null) => {
			filesChanged.current = true;
			if (!visibleFiles.current) return;
			const run = ++generation.current;
			fileRead.current?.abort();
			const controller = new AbortController();
			fileRead.current = controller;
			setFilesBusy(true);
			try {
				const data = await api<{
					items: DeliveryFile[];
					nextCursor: string | null;
				}>(
					`${base}/files?purpose=delivery${next ? `&cursor=${next}` : ""}`,
					"GET",
					undefined,
					{ signal: controller.signal },
				);
				if (run !== generation.current) return;
				setFiles((old) => (next ? [...old, ...data.items] : data.items));
				setCursor(data.nextCursor);
				setFileError("");
				filesChanged.current = false;
			} catch (e) {
				if (run !== generation.current || controller.signal.aborted) return;
				if (e instanceof ApiError && e.status === 401) invalidRef.current();
				setFileError(e instanceof Error ? e.message : "读取成果附件失败。");
			} finally {
				if (run === generation.current) setFilesBusy(false);
			}
		},
		[base],
	);
	const refreshFiles = useCallback(() => void loadFiles(), [loadFiles]);
	useEffect(() => {
		if (visible && filesChanged.current) void loadFiles();
		if (!visible) setFilesBusy(false);
		return () => {
			generation.current++;
			fileRead.current?.abort();
		};
	}, [loadFiles, visible]);
	useProjectUpdates((updates) => {
		if (updates.some((e) => e.kind === "file.changed" || e.kind === "resync"))
			void loadFiles();
	});

	const value = { description, fileIds: selected },
		blocked = save.disabled || publish.disabled || uploadBusy;
	const availableFiles = [
		...new Map(
			[...(draft?.files ?? []), ...pickedFiles, ...files].map((file) => [
				file.id,
				file,
			]),
		).values(),
	];
	// Preserve an existing text-only draft; new empty deliveries start with upload only.
	const hasContent = availableFiles.length > 0 || !!draft?.description;
	return (
		<section className="delivery-editor" aria-label="交付草稿">
			<p className="delivery-draft-state" role="status">
				{save.busy
					? "正在保存草稿…"
					: publish.busy
						? "正在发布成果…"
						: uploadBusy
							? "附件上传中，完成后可保存。"
							: save.dirty
								? "有未保存修改"
								: draft
									? "草稿已保存"
									: "准备草稿"}
			</p>
			<UploadQueue
				base={base}
				purpose="delivery"
				compact
				buttonLabel="上传成果附件"
				onBusyChange={setUploadBusy}
				onPendingChange={uploadChanged}
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
			{filesBusy ? (
				<p role="status" className="muted">
					正在读取可选成果附件…
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
							<div className="evidence-pick-list delivery-attachment-picker">
								{availableFiles.map((file) => (
									<label key={file.id}>
										<input
											type="checkbox"
											checked={selected.includes(file.id)}
											disabled={
												!selected.includes(file.id) && selected.length >= 20
											}
											onChange={(e) => {
												const checked = e.target.checked;
												setPickedFiles((old) =>
													checked
														? [
																...old.filter((item) => item.id !== file.id),
																file,
															]
														: old.filter((item) => item.id !== file.id),
												);
												setSelected((old) =>
													e.target.checked
														? [...old, file.id]
														: old.filter((id) => id !== file.id),
												);
												save.changed();
											}}
										/>
										<span>
											{file.filename}
											<small>{sizeLabel(file.byteSize)}</small>
										</span>
									</label>
								))}
							</div>
							{cursor ? (
								<button
									type="button"
									disabled={filesBusy}
									onClick={() => void loadFiles(cursor)}
								>
									{filesBusy ? "读取附件中…" : "更多成果附件"}
								</button>
							) : null}
						</fieldset>
						<button
							type="submit"
							className={!draft || save.dirty ? "primary" : undefined}
							disabled={
								uploadBusy ||
								save.readOnly ||
								save.busy ||
								save.conflict ||
								publish.busy ||
								publish.blocked
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
									uploadBusy ||
									save.readOnly ||
									save.dirty ||
									save.busy ||
									save.blocked ||
									publish.busy ||
									publish.conflict ||
									!draft.files.length
								}
								onClick={async () => {
									if (
										publish.blocked ||
										(await confirm({
											title: "发布交付版本？",
											description: `客户将可下载这 ${draft.files.length} 份附件：\n${draft.files.map((f) => f.filename).join("\n")}\n\n版本说明：${draft.description || "无"}\n发布后保留固定版本，不能覆盖。`,
											confirmLabel: "确认发布",
											cancelLabel: "继续检查",
										}))
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
								输入已保留，请重试。遇到冲突可先复制草稿，再重新载入。
							</p>
							<button
								type="button"
								onClick={async () => {
									try {
										await navigator.clipboard.writeText(
											JSON.stringify(value, null, 2),
										);
										setCopyNotice("草稿已复制，请妥善保存。");
									} catch {
										save.setError("复制未完成，请保留本页。");
									}
								}}
							>
								复制交付草稿
							</button>
							{copyNotice ? <p role="status">{copyNotice}</p> : null}
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
