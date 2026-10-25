"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { useApiRevalidation } from "./use-api-revalidation";
import { readSavedShare, saveShare, forgetSavedShare, savedShareEvent } from "./saved-share-links";
import { ProjectLiveProvider, useProjectUpdates } from "./project-live";
import type { ProjectView } from "./projects";
import { WorkspaceIcon, useWorkspaceDisclosure } from "./workspace-ui";
import "./workspace.css";
import "./workspace-measurement.css";
import "./workspace-popup.css";
import "./annotation-properties.css";
import "./measurement-reply.css";
import { AnnotatedThumbnail } from "./annotated-thumbnail";
import { WorkspaceContextDialog } from "./workspace-context-dialog";
import { WorkspaceSideTarget } from "./workspace-side-content";
import { UploadQueue } from "./upload-queue";
import { AnnotationEditor } from "./annotation-editor";
import { AnnotatedImageExport } from "./annotated-image-export";
import { ZipPackageExport } from "./zip-package-export";
import { FileIssues } from "./file-issues";
import { IssueInbox } from "./issue-inbox";
import { IssueDetail } from "./issue-detail";
import { DeliverySection } from "./delivery-section";
import { ArchiveProjectButton } from "./archive-project-button";
import { ProjectReadOnly } from "./project-read-only";
import { type FileFilters, defaultFileFilters, fileTypes, fileSorts, filesUrl } from "@/lib/archive-filters";
import { useWorkspaceTheme } from "./use-workspace-theme";
import { EntryShell } from "./entry-shell";
type Asset = {
	id: string;
	filename: string;
	mime: string;
	extension: string;
	byteSize: number;
	uploaderType: string;
	createdAt: string;
	thumbnail?: {version:string;width:number;height:number}|null;
	annotationSummary?: { version: string; count: number } | null;
};
function formatBytes(value: number) {
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
	return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}
export function Unavailable() {
	return (
		<EntryShell
			eyebrow="项目访问"
			title="继续清楚地协作。"
			description="通过工程师分享的链接进入项目。"
		>
			<h1>链接已不可用</h1>
			<p className="muted">请向工程师索取新链接。</p>
			<a className="button primary" href="/">
				返回首页
			</a>
		</EntryShell>
	);
}
export function Bootstrap({ token }: { token: string }) {
	const [error, setError] = useState(false);
	useEffect(() => {
		let active = true;
		void api<{ projectId: string }>("/api/guest/session", "POST", { token })
			.then((result) => {
				if (active)
					window.location.replace(`/s/session?project=${result.projectId}`);
			})
			.catch(() => {
				if (active) {
					window.history.replaceState(null, "", "/s/session");
					setError(true);
				}
			});
		return () => {
			active = false;
		};
	}, [token]);
	return error ? (
		<Unavailable />
	) : (
		<EntryShell
			eyebrow="客户协作"
			title="资料、测量与交付。"
			description="无需注册，进入项目即可协作。"
		>
			<span className="entry-spinner" aria-hidden="true" />
			<h1>正在打开项目…</h1>
			<p role="status">验证分享权限，请稍候。</p>
		</EntryShell>
	);
}
export function Workspace({initial, guest = false}: {initial: ProjectView; guest?: boolean}) {
 const [invalid,setInvalid] = useState(false);
 const onInvalid = useCallback(() => setInvalid(true), []);
 if (invalid) return <Unavailable />;
 return <ProjectLiveProvider base={`/api/${guest ? "guest/" : ""}projects/${initial.id}`} cursor={initial.syncCursor} onInvalid={onInvalid}>
  <WorkspaceContent initial={initial} guest={guest} />
 </ProjectLiveProvider>;
}
function WorkspaceContent({
	initial,
	guest = false,
}: {
	initial: ProjectView;
	guest?: boolean;
}) {
	const themeStyle = useWorkspaceTheme(guest);
	const [imageExportFile, setImageExportFile] = useState<string | null>(null);
	const [packageSelection, setPackageSelection] = useState<"pdf" | "zip" | null>(null), [exportFiles, setExportFiles] = useState<string[]>([]), [exportBusy, setExportBusy] = useState(false), [exportNotice, setExportNotice] = useState("");
	const pdfSelection = packageSelection === "pdf", zipSelection = packageSelection === "zip";
	const [project, setProject] = useState(initial),
		[section, setSection] = useState("files"),
		[assets, setAssets] = useState<Asset[]>([]),
		[cursor, setCursor] = useState<string | null>(null),
		[selected, setSelected] = useState<Asset | null>(null);
	const [selectedIssue, setSelectedIssue] = useState<string | null>(null),
		[issueRefresh, setIssueRefresh] = useState(0);

	const [popupSelection, setPopupSelection] = useState<{
		file: Asset;
		annotationId: string;
	} | null>(null);
	const [initialAnnotation, setInitialAnnotation] = useState<string>();
	const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
	const [overlayIssue, setOverlayIssue] = useState<string | null>(null);
	const overlayDirty = useRef(false);
	const inboxDirty = useRef(false);
	const onInboxDirty = useCallback((dirty: boolean) => {
		inboxDirty.current = dirty;
	}, []);
	const onOverlayDirty = useCallback((dirty: boolean) => {
		overlayDirty.current = dirty;
	}, []);
	const [thumbnailRefresh, setThumbnailRefresh] = useState<
		Record<string, number>
	>({});
	const annotationsSaved = useCallback(
		(fileId: string) =>
			setThumbnailRefresh((old) => ({
				...old,
				[fileId]: (old[fileId] ?? 0) + 1,
			})),
		[],
	);
	const issueUpdated = useCallback(() => setIssueRefresh((v) => v + 1), []);
	const [error, setError] = useState(""),
		[loading, setLoading] = useState(true),
		[invalid, setInvalid] = useState(false);
	const [fileFilters, setFileFilters] = useState<FileFilters>(defaultFileFilters);
	const archived = !!project.archivedAt;
	const editorDirty = useRef(false),
		deliveryDirty = useRef(false);
	const onDeliveryDirty = useCallback((dirty: boolean) => {
		deliveryDirty.current = dirty;
	}, []);
	const info = useWorkspaceDisclosure();
	const infoPanel = useRef<HTMLDivElement>(null),
		infoTrigger = useRef<HTMLButtonElement>(null);
	const materials = useRef<HTMLElement>(null);
	const [paging, setPaging] = useState(false);
	const [changingView, setChangingView] = useState(false);
	const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (navigationTimer.current) clearTimeout(navigationTimer.current);
		},
		[],
	);
	function changeView(action: () => void) {
		if (navigationTimer.current) clearTimeout(navigationTimer.current);
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			action();
			return;
		}
		setChangingView(true);
		navigationTimer.current = setTimeout(() => {
			navigationTimer.current = null;
			action();
			setChangingView(false);
		}, 140);
	}
	const [sideTarget, setSideTarget] = useState<HTMLDivElement | null>(null);
	const contextActive =
		section === "files" &&
		(!!selectedIssue ||
			!!selected?.mime.startsWith("image/") ||
			!!popupSelection);
	const detailId = selectedIssue ?? selected?.id ?? "";
	useEffect(() => {
		if (!detailId) return;
		const frame = requestAnimationFrame(() =>
			materials.current?.scrollIntoView({
				block: "start",
				behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
					? "instant"
					: "smooth",
			}),
		);
		return () => cancelAnimationFrame(frame);
	}, [detailId]);
	useEffect(() => {
		if (!info.mounted) return;
		function dismiss(event: PointerEvent) {
			if (
				event.target instanceof Node &&
				!infoPanel.current?.contains(event.target) &&
				!infoTrigger.current?.contains(event.target)
			)
				info.hide();
		}
		document.addEventListener("pointerdown", dismiss);
		return () => document.removeEventListener("pointerdown", dismiss);
	}, [info.mounted, info.hide]);
	useEffect(() => {
		function prevent(event: BeforeUnloadEvent) {
			if (
				editorDirty.current ||
				deliveryDirty.current ||
				overlayDirty.current ||
				inboxDirty.current
			) {
				event.preventDefault();
				event.returnValue = "";
			}
		}
		window.addEventListener("beforeunload", prevent);
		return () => window.removeEventListener("beforeunload", prevent);
	}, []);
	const onEditorDirty = useCallback((dirty: boolean) => {
		editorDirty.current = dirty;
	}, []);
	function allowLeave() {
		return (
			(!editorDirty.current &&
				!deliveryDirty.current &&
				!overlayDirty.current &&
				!inboxDirty.current) ||
			window.confirm(
				"有未保存或未确认的修改，仍要切换或离开吗？已发出的请求可能仍完成。",
			)
		);
	}
	function selectFile(file: Asset | null) {
		if (exportBusy) return;
		if (
			(selected?.id !== file?.id ||
				selectedIssue ||
				popupSelection ||
				overlayIssue) &&
			!allowLeave()
		)
			return;
		changeView(() => {
			setSelectedIssue(null);
			setPopupSelection(null);
			setOverlayIssue(null);
			setMobilePanelOpen(false);
			setInitialAnnotation(undefined);
			setSelected(file);
			if (!file) void load();
		});
	}
	function selectIssue(id: string) {
		if (selectedIssue !== id && !allowLeave()) return;
		changeView(() => {
			setSelected(null);
			setPopupSelection(null);
			setOverlayIssue(null);
			setMobilePanelOpen(true);
			setSelectedIssue(id);
		});
	}
	function openProperties() {
		if (
			overlayDirty.current &&
			!window.confirm("有未提交的回复，仍要切换标注吗？")
		)
			return false;
		setOverlayIssue(null);
		setMobilePanelOpen(true);
		return true;
	}
	function openPhotoIssue(id: string) {
		if (!window.matchMedia("(max-width: 700px)").matches) {
			selectIssue(id);
			return;
		}
		if (
			overlayIssue !== id &&
			overlayDirty.current &&
			!window.confirm("有未提交的回复，仍要切换吗？")
		)
			return;
		setOverlayIssue(id);
		setMobilePanelOpen(true);
	}
	function returnToAnnotation() {
		if (
			overlayDirty.current &&
			!window.confirm("有未提交的回复，仍要返回标注吗？")
		)
			return;
		setOverlayIssue(null);
	}
	function openThumbnailAnnotation(file: Asset, annotationId: string) {
		if (exportBusy) return;
		if (
			popupSelection?.file.id === file.id &&
			popupSelection.annotationId === annotationId &&
			!overlayIssue
		) {
			setMobilePanelOpen(true);
			return;
		}
		if (!allowLeave()) return;
		if (window.matchMedia("(max-width: 700px)").matches) {
			setPopupSelection({ file, annotationId });
			setOverlayIssue(null);
			setMobilePanelOpen(true);
		} else {
			changeView(() => {
				setSelected(file);
				setSelectedIssue(null);
				setPopupSelection(null);
				setOverlayIssue(null);
				setInitialAnnotation(annotationId);
			});
		}
	}
	function selectSection(next: string) {
		if (next !== section && !allowLeave()) return;
		changeView(() => setSection(next));
	}
	const [shareUrl, setShareUrl] = useState(""),
		[shareMessage, setShareMessage] = useState(""),
		[shareBusy, setShareBusy] = useState(false);
	const currentShare = useRef<{ id: string; url: string } | null>(null);
	const savedShareId = project.share?.id, savedShareExpiry = project.share?.expiresAt, savedShareRevoked = project.share?.revokedAt;
	useEffect(() => {
		if (guest) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		function restore() {
			if (timer) clearTimeout(timer);
			const metadata = savedShareId && savedShareExpiry ? { id: savedShareId, expiresAt: savedShareExpiry, revokedAt: savedShareRevoked ?? null } : null;
			const remaining = Date.parse(savedShareExpiry ?? "") - Date.now();
			const valid = remaining > 0 && !savedShareRevoked;
			const remembered = currentShare.current;
			setShareUrl(readSavedShare(project.id, metadata, window.location.origin) || (valid && remembered && remembered.id === savedShareId ? remembered.url : ""));
			if (valid)
				timer = setTimeout(restore, Math.min(remaining + 20, 2147483647));
		}
		const cleared = () => { currentShare.current = null; restore(); };
		restore();
		window.addEventListener("storage", cleared);
		window.addEventListener(savedShareEvent, cleared);
		return () => { if (timer) clearTimeout(timer); window.removeEventListener("storage", cleared); window.removeEventListener(savedShareEvent, cleared); };
	}, [guest, project.id, savedShareId, savedShareExpiry, savedShareRevoked]);
	const [name, setName] = useState(project.name),
		[description, setDescription] = useState(project.description),
		[saving, setSaving] = useState(false);
	const projectDraft = useRef({ dirty: false, revision: project.revision });
	const [projectNotice, setProjectNotice] = useState("");
	const base = `/api/${guest ? "guest/" : ""}projects/${project.id}`;
	const onInvalid = useCallback(() => {
		if (navigationTimer.current) clearTimeout(navigationTimer.current);
		setInvalid(true);
		setPopupSelection(null);
		setOverlayIssue(null);
		setMobilePanelOpen(false);
		setAssets([]);
		setSelected(null);
		setSelectedIssue(null);
		setShareUrl("");
		currentShare.current = null;
		forgetSavedShare(initial.id);
	}, [initial.id]);
	const failure = useCallback(
		(e: unknown) => {
			if (e instanceof ApiError && e.status === 401) {
				onInvalid();
				return;
			}
			setError(e instanceof Error ? e.message : "网络中断，请重试。");
		},
		[onInvalid],
	);
	const fileLoadRun = useRef(0);
	const fileReading = useRef<AbortController | null>(null);
	const load = useCallback(async () => {
		const run = ++fileLoadRun.current;
		fileReading.current?.abort();
		const controller = new AbortController();
		fileReading.current = controller;
		setLoading(true); setPaging(false);
		try {
			const result = await api<{ items: Asset[]; nextCursor: string | null }>(
				filesUrl(base, fileFilters),
				"GET", undefined, { signal: controller.signal },
			);
			if (run !== fileLoadRun.current) return;
			setAssets(result.items);
			setCursor(result.nextCursor);
			setError("");
		} catch (e) {
			if (run === fileLoadRun.current) failure(e);
		} finally {
			if (run === fileLoadRun.current) setLoading(false);
		}
	}, [base, failure, fileFilters]);
	useEffect(() => {
		void load();
        return () => { fileLoadRun.current++; fileReading.current?.abort(); };
	}, [load]);
	useApiRevalidation(() => { if (!selected && !selectedIssue) void load(); });
 useProjectUpdates(updates => {
  if (updates.some(e => e.kind === "file.changed" || e.kind === "resync")) void load();
  for (const event of updates) if ((event.kind === "annotation.changed" || event.kind === "issue.changed") && event.fileId) annotationsSaved(event.fileId);
  if (updates.some(e => e.kind === "issue.changed" || e.kind === "resync")) issueUpdated();
  if (updates.some(e => e.kind === "project.changed" || e.kind === "access.changed" || e.kind === "resync")) {
   void api<ProjectView>(base).then(data => {
    setProject(old => old.revision > data.revision ? old : ({...old,...data}));
    if (data.revision <= projectDraft.current.revision) return;
    if (projectDraft.current.dirty) setProjectNotice("项目说明已在别处更新；当前输入已保留，保存时检查冲突。");
    else { setName(data.name); setDescription(data.description); projectDraft.current.revision = data.revision; }
   }).catch(failure);
  }
 });

	async function rotate() {
		if (
			project.share &&
			!project.share.revokedAt &&
			!window.confirm("重新生成后，旧链接及客户会话将失效。继续？")
		)
			return;
		setShareBusy(true);
		setShareMessage("");
		try {
			const result = await api<{
				id: string;
				url: string | null;
				expiresAt: string;
			}>(`${base}/share-links`, "POST", {});
			setShareUrl(result.url ?? "");
			currentShare.current = result.url ? { id: result.id, url: result.url } : null;
			const retained = result.url ? saveShare(project.id, { id: result.id, expiresAt: result.expiresAt, revokedAt: null }, result.url) : false;
			setShareMessage(
				result.url
					? retained ? "链接已生成，本浏览器刷新后可继续复制，撤销或过期后移除。" : "链接已生成；浏览器未允许保存，请复制留存。"
					: "请求已处理，请重新生成以获取新地址。",
			);
			setProject((old) => ({
				...old,
				share: { id: result.id, expiresAt: result.expiresAt, revokedAt: null },
			}));
		} catch (e) {
			failure(e);
		} finally {
			setShareBusy(false);
		}
	}
	async function loadMore() {
		if (!cursor || paging) return;
		const run = fileLoadRun.current;
		const signal = fileReading.current?.signal;
		if (!signal) return;
		setPaging(true);
		try {
			const next = await api<{ items: Asset[]; nextCursor: string | null }>(
				filesUrl(base, fileFilters, cursor), "GET", undefined, { signal },
			);
			if (run !== fileLoadRun.current) return;
			setAssets((old) => [
				...old,
				...next.items.filter(
					(file) => !old.some((existing) => existing.id === file.id),
				),
			]);
			setCursor(next.nextCursor);
		} catch (e) {
			if (run === fileLoadRun.current && !signal.aborted) failure(e);
		} finally {
			if (run === fileLoadRun.current) setPaging(false);
		}
	}
	function changeFileFilters(next: FileFilters) {
		if (exportBusy || !allowLeave()) return false;
		setExportFiles([]); if (packageSelection) setExportNotice("筛选已改变，请重新选择导出资料。");
		setSelected(null); setSelectedIssue(null); setPopupSelection(null);
		setAssets([]); setCursor(null); setFileFilters(next);
		return true;
	}
	if (invalid) return <Unavailable />;
	return (
		<WorkspaceSideTarget value={sideTarget}>
			<ProjectReadOnly.Provider value={archived}>
			<main
				className="workspace workspace-redesign"
				style={themeStyle}
				onKeyDown={(event) => {
					if (event.key === "Escape" && info.mounted) {
						info.hide();
						infoTrigger.current?.focus();
					}
				}}
			>
				<header className="workspace-topbar">
					<span className="brand">PartMeasure</span>
					<h1 className="workspace-project-title">
						<button
							ref={infoTrigger}
							type="button"
							className="workspace-project-trigger"
							aria-expanded={info.expanded}
							aria-controls="workspace-project-info"
							onClick={() => (info.expanded ? info.hide() : info.show())}
						>
							<span>{project.name}</span>
							<WorkspaceIcon kind="chevron" />
						</button>
					</h1>
					<a
						className="workspace-home"
						href="/projects"
						aria-label="返回项目列表"
						onClick={(event) => {
							if (!allowLeave()) event.preventDefault();
						}}
					>
						<WorkspaceIcon kind="home" />
					</a>
					{info.mounted ? (
						<div
							ref={infoPanel}
							className="workspace-project-info"
							id="workspace-project-info"
							data-phase={info.phase}
							inert={info.phase === "closing"}
						>
							<p className="eyebrow">
								{guest ? "客户资料协作 · 无需注册 · 仅此项目" : "工程师工作台"}
							</p>
							<h2>项目说明</h2>
							<p className="preserve-lines">
								{project.description || "请上传零件照片或现有工程资料。"}
							</p>
							{!guest ? (
								<details className="project-settings" onToggle={event => {
									if (!event.currentTarget.open || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
									const content = event.currentTarget.querySelector<HTMLElement>(".project-settings-content");
									if (!content) return;
									const duration = 180 * Number(getComputedStyle(content).getPropertyValue("--workspace-motion") || 1);
									content.animate([{ height: "0px" }, { height: `${content.scrollHeight}px` }], { duration, easing: "ease-out" });
								}}>
									<summary>编辑说明与分享</summary>
									<div className="project-settings-content">
									<ArchiveProjectButton project={project} beforeChange={allowLeave} onSaved={updated => {
										setProject(old => old.revision > updated.revision ? old : ({ ...old, ...updated }));
										if (!projectDraft.current.dirty) projectDraft.current.revision = updated.revision;
									}} />
									<form
										className="stack"
										onSubmit={async (e) => {
											e.preventDefault();
											setSaving(true);
											try {
												const updated = await api<ProjectView>(
													base,
													"PATCH",
													{ name, description },
													{ revision: projectDraft.current.revision },
												);
												setProject((old) => ({ ...old, ...updated }));
												projectDraft.current = { dirty: false, revision: updated.revision };
												setName(updated.name); setDescription(updated.description); setProjectNotice("");
												setError("");
											} catch (err) {
												failure(err);
											} finally {
												setSaving(false);
											}
										}}
									>
										<label>
											项目名称
											<input
												value={name}
												maxLength={120}
												required
												disabled={saving || archived}
													onChange={(e) => { projectDraft.current.dirty = true; setName(e.target.value); }}
											/>
										</label>
										<label>
											项目说明
											<textarea
												value={description}
												maxLength={4000}
												disabled={saving || archived}
													onChange={(e) => { projectDraft.current.dirty = true; setDescription(e.target.value); }}
											/>
										</label>
										{projectNotice ? <p role="status">{projectNotice} <button type="button" disabled={saving} onClick={() => { if (window.confirm("放弃当前项目说明输入，载入已收到的最新版本？")) { setName(project.name); setDescription(project.description); projectDraft.current = { dirty: false, revision: project.revision }; setProjectNotice(""); } }}>载入最新说明</button></p> : null}
										<button type="submit" disabled={saving || archived}>
											{saving ? "保存中…" : "保存项目说明"}
										</button>
									</form>
									<h2>客户分享链接</h2>
									<p className="muted">
											持链接者可查看客户可见资料、上传和下载；归档期间只读。有效期 30
										天，可随时撤销。请只发给协作人员。
									</p>
									<div className="actions">
										<button
											type="button"
											disabled={shareBusy || archived}
											onClick={() => void rotate()}
										>
											{project.share && !project.share.revokedAt
												? "重新生成链接"
												: "生成分享链接"}
										</button>
										{project.share && !project.share.revokedAt ? (
											<button
												type="button"
												className="danger"
												disabled={shareBusy}
												onClick={async () => {
													if (
														!window.confirm(
															"撤销后旧链接与客户会话将失效，已下载副本无法收回。",
														)
													)
														return;
													setShareBusy(true);
													try {
														await api(
															`${base}/share-links/${project.share?.id}`,
															"DELETE",
														);
														setShareUrl("");
														currentShare.current = null;
														forgetSavedShare(project.id);
														setProject((old) => ({
															...old,
															share: old.share
																? {
																		...old.share,
																		revokedAt: new Date().toISOString(),
																	}
																: null,
														}));
														setShareMessage("已撤销。");
													} catch (e) {
														failure(e);
													} finally {
														setShareBusy(false);
													}
												}}
											>
												撤销链接
											</button>
										) : null}
									</div>
									{shareUrl ? (
										<label>
											分享地址
											<input
												readOnly
												value={shareUrl}
												aria-label="分享地址"
											/>
											<button
												type="button"
												onClick={async () => {
													try {
														await navigator.clipboard.writeText(shareUrl);
														setShareMessage("已复制。");
													} catch {
														setShareMessage(
															"无法自动复制，请选中地址手动复制。",
														);
													}
												}}
											>
												复制链接
											</button>
										</label>
									) : null}
									<p role="status">
										{shareMessage ||
											(project.share && !project.share.revokedAt
												? shareUrl ? "当前链接有效，可随时复制。" : "此浏览器未保留当前链接地址；可重新生成并保留新链接。"
												: "尚无有效分享链接。")}
									</p>
									</div>
								</details>
							) : null}
						</div>
					) : null}
				</header>
				<nav className="workspace-mobile-tabs" aria-label="项目工作区">
					<button
						type="button"
						aria-pressed={section === "files"}
						onClick={() => selectSection("files")}
					>
						资料与测量
					</button>
					<button
						type="button"
						aria-pressed={section === "deliveries"}
						onClick={() => selectSection("deliveries")}
					>
						交付与版本
					</button>
				</nav>
				{error ? (
					<p role="alert" className="error workspace-error">
						{error}{" "}
						<button type="button" onClick={() => void load()}>
							重试加载
						</button>
					</p>
				) : null}
				{archived ? <p className="workspace-archive-notice" role="status">项目已归档：仅可查看和下载，恢复后可继续编辑。{!guest ? "可在项目说明中恢复或撤销分享。" : "请联系工程师恢复。"}</p> : null}
				<div
					className="workspace-panels"
					data-changing={changingView}
					inert={changingView}
				>
					<section
						ref={materials}
						className="workspace-materials"
						aria-label="资料与测量"
						data-mobile-active={section === "files"}
					>
						<header className="workspace-section-heading">
							<h2>资料与测量</h2>
						</header>
						<IssueInbox
							key={base}
							base={base}
							guest={guest}
							refreshKey={issueRefresh}
							onInvalid={onInvalid}
							onUpdated={issueUpdated}
							onDirty={onInboxDirty}
						/>
						<div hidden={!!selected || !!selectedIssue}>
							<div className="workspace-file-filters">
								<label>类型 <select disabled={exportBusy} value={fileFilters.type} onChange={event => changeFileFilters({ ...fileFilters, type: event.target.value as FileFilters["type"] })}>{Object.entries(fileTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
								<label>排序 <select disabled={exportBusy} value={fileFilters.sort} onChange={event => changeFileFilters({ ...fileFilters, sort: event.target.value as FileFilters["sort"] })}>{Object.entries(fileSorts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
								{!packageSelection ? <><button type="button" onClick={() => { if (fileFilters.type !== "image") { if (!changeFileFilters({ ...fileFilters, type: "image" })) return; } else if (!allowLeave()) return; setPackageSelection("pdf"); setExportFiles([]); setExportNotice("在下方勾选1–8张照片，按选择顺序生成PDF。"); }}>PDF资料报告</button><button type="button" onClick={() => { if (!allowLeave()) return; setPackageSelection("zip"); setExportFiles([]); setExportNotice("在下方勾选最多20项资料，可附加所选已发布附件。"); }}>ZIP资料包</button></> : null}
							</div>
							{pdfSelection ? <div className="workspace-pdf-selection">
								<p role="status">已选 {exportFiles.length} / 8 张。{exportNotice}</p>
								{exportFiles[0] ? <AnnotatedImageExport key={base} base={base} fileId={exportFiles[0]} fileIds={exportFiles} reportOnly onInvalid={onInvalid} onBusyChange={setExportBusy} onClose={() => { setPackageSelection(null); setExportFiles([]); }} /> : <><button type="button" disabled>生成PDF（请先勾选照片）</button><button type="button" onClick={() => setPackageSelection(null)}>取消选择</button></>}
							</div> : null}
							{zipSelection ? <div className="workspace-pdf-selection"><p role="status">已选资料 {exportFiles.length} / 20。{exportNotice}</p><ZipPackageExport key={base} base={base} guest={guest} materialIds={exportFiles} onInvalid={onInvalid} onBusyChange={setExportBusy} onClose={() => { setPackageSelection(null); setExportFiles([]); }} /></div> : null}
							{loading ? (
								<p role="status">加载资料…</p>
							) : assets.length === 0 ? (
								<p className="empty">当前类型下暂无资料，可调整筛选条件。</p>
							) : null}
							<ul className="workspace-gallery">
								{assets.map((file) => (
									<li key={file.id}>
										{zipSelection ? <label className="workspace-pdf-checkbox"><input type="checkbox" checked={exportFiles.includes(file.id)} disabled={exportBusy || !exportFiles.includes(file.id) && exportFiles.length >= 20} onChange={event => { const checked = event.target.checked; setExportFiles(ids => checked ? ids.length < 20 ? [...ids, file.id] : ids : ids.filter(id => id !== file.id)); }} />选入ZIP：{file.filename}</label> : null}
										{file.mime.startsWith("image/") ? (
											<div className="workspace-asset">
												{pdfSelection ? <label className="workspace-pdf-checkbox"><input type="checkbox" checked={exportFiles.includes(file.id)} disabled={exportBusy || !exportFiles.includes(file.id) && exportFiles.length >= 8} onChange={event => { const checked = event.target.checked; setExportFiles(ids => checked ? ids.length < 8 ? [...ids, file.id] : ids : ids.filter(id => id !== file.id)); }} />选入PDF：{file.filename}</label> : null}
												<AnnotatedThumbnail
													base={base}
													fileId={file.id}
              thumbnail={file.thumbnail}
													refreshKey={thumbnailRefresh[file.id] ?? 0}
												annotationVersion={file.annotationSummary?.version}
												annotationCount={file.annotationSummary?.count}
													onInvalid={onInvalid}
													name={file.filename}
													onBrowse={() => selectFile(file)}
													onAnnotation={(id) =>
														openThumbnailAnnotation(file, id)
													}
												/>
												<span className="workspace-image-meta">
													{file.uploaderType === "owner" ? "工程师" : "客户"}
													上传 ·{" "}
													{new Date(file.createdAt).toLocaleDateString(
														"zh-CN",
														{ timeZone: "Asia/Shanghai" },
													)}
												</span>
											</div>
										) : (
											<button
												type="button"
												className="workspace-asset"
												aria-label={`查看 ${file.filename}`}
												onClick={() => selectFile(file)}
											>
												<span className="workspace-file-tile">
													<WorkspaceIcon kind="file" />
													<strong>{file.filename}</strong>
													<small>
														{file.extension.toUpperCase()} ·{" "}
														{formatBytes(Number(file.byteSize))}
													</small>
													<small>
														{file.uploaderType === "owner" ? "工程师" : "客户"}
														上传
													</small>
												</span>
											</button>
										)}
									</li>
								))}
							</ul>
							{cursor ? (
								<button
									type="button"
									disabled={paging}
									onClick={() => void loadMore()}
								>
									{paging ? "加载中…" : "加载更多资料"}
								</button>
							) : null}
						</div>
						<section
							className="workspace-file-detail"
							hidden={!selected && !selectedIssue}
							aria-label="文件详情"
						>
							{selectedIssue ? (
								<IssueDetail
									key={selectedIssue}
									base={base}
									id={selectedIssue}
									guest={guest}
									onInvalid={onInvalid}
									onUpdated={issueUpdated}
									onDirty={onEditorDirty}
									onBack={() => selectFile(null)}
									onOpenProperties={() => setMobilePanelOpen(true)}
								/>
							) : null}
							{selected ? (
								<button
									className="back-to-files"
									type="button"
									onClick={() => selectFile(null)}
								>
									返回资料
								</button>
							) : null}
							{selected ? (
								<>
									<div className="detail-heading">
										<h2>{selected.filename}</h2>
										<details className="workspace-file-menu">
											<summary aria-label="文件操作">···</summary>
											<div className="workspace-file-menu-items">
												{selected.mime.startsWith("image/") ? <button type="button" onClick={event => { setImageExportFile(selected.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}>导出图片／PDF</button> : null}
												<a
													className="button"
													href={`${base}/files/${selected.id}/download`}
												>
													下载
													{selected.mime.startsWith("image/")
														? "标准图"
														: "附件"}
												</a>
												{!guest && selected.mime.startsWith("image/") ? (
													<a
														className="button"
														href={`${base}/files/${selected.id}/download?original=1`}
													>
														下载原件
													</a>
												) : null}
												{!guest ? (
													<button
														type="button"
														className="danger"
														disabled={archived}
														onClick={async () => {
															if (!allowLeave()) return;
															if (
																!window.confirm(
																	`将“${selected.filename}”从当前列表隐藏？原件和必要历史仍保留。`,
																)
															)
																return;
															try {
																await api(
																	`${base}/files/${selected.id}`,
																	"DELETE",
																);
																setSelected(null);
																await load();
															} catch (e) {
																failure(e);
															}
														}}
													>
														隐藏文件
													</button>
												) : null}
											</div>
										</details>
									</div>
									{selected.mime.startsWith("image/") ? (
										imageExportFile === selected.id ? <AnnotatedImageExport key={selected.id} base={base} fileId={selected.id} onInvalid={onInvalid} onClose={() => setImageExportFile(null)} /> : null
									) : null}
									{selected.mime.startsWith("image/") ? (
										<AnnotationEditor
											key={selected.id}
											base={base}
											fileId={selected.id}
											guest={guest}
											onInvalid={onInvalid}
											onDirty={onEditorDirty}
											refreshKey={issueRefresh}
											onIssueCreated={issueUpdated}
											onAnnotationsSaved={() => annotationsSaved(selected.id)}
											onOpenIssue={openPhotoIssue}
											onOpenProperties={openProperties}
											initialAnnotationId={initialAnnotation}
											panelHidden={!!overlayIssue}
										/>
									) : (
										<>
											<div className="empty">
												<p>{selected.extension.toUpperCase()} 附件</p>
												<p>下载查看</p>
											</div>
											<FileIssues
												key={selected.id}
												base={base}
												fileId={selected.id}
												guest={guest}
												onInvalid={onInvalid}
												onOpen={selectIssue}
												onCreated={issueUpdated}
												onDirty={onEditorDirty}
											/>
										</>
									)}
								</>
							) : null}
						</section>
						<UploadQueue
							base={base}
							floating
							onReady={() => void load()}
							onInvalid={onInvalid}
						/>
					</section>
					<aside
						className="workspace-deliveries"
						aria-label={
							contextActive
								? guest
									? "标注与属性"
									: "标注与属性"
								: "交付与版本"
						}
						data-mobile-active={section === "deliveries"}
						data-context-active={contextActive}
					>
						<div hidden={contextActive}>
							<h2>交付与版本</h2>
							<DeliverySection
								active={!contextActive}
								base={base}
								guest={guest}
								onInvalid={onInvalid}
								onDirty={onDeliveryDirty}
							/>
						</div>
					</aside>
					{popupSelection ? (
						<AnnotationEditor
							key={popupSelection.file.id}
							base={base}
							fileId={popupSelection.file.id}
							guest={guest}
							propertiesOnly
							initialAnnotationId={popupSelection.annotationId}
							panelHidden={!!overlayIssue}
							onOpenProperties={openProperties}
							onInvalid={onInvalid}
							onDirty={onEditorDirty}
							refreshKey={issueRefresh}
							onIssueCreated={issueUpdated}
							onAnnotationsSaved={() =>
								annotationsSaved(popupSelection.file.id)
							}
							onOpenIssue={openPhotoIssue}
						/>
					) : null}
					{overlayIssue ? (
						<IssueDetail
							key={overlayIssue}
							base={base}
							id={overlayIssue}
							guest={guest}
							panelOnly
							onInvalid={onInvalid}
							onUpdated={issueUpdated}
							onDirty={onOverlayDirty}
							onBack={returnToAnnotation}
						/>
					) : null}
					<WorkspaceContextDialog
						minimalHeader={guest && !!popupSelection && !overlayIssue}
						active={contextActive}
						mobileOpen={mobilePanelOpen}
						title={
							guest
								? "标注与属性"
								: overlayIssue || selectedIssue
									? "标注与属性"
									: "标注与属性"
						}
						onClose={() => setMobilePanelOpen(false)}
						targetRef={setSideTarget}
					/>
				</div>
			</main>
			</ProjectReadOnly.Provider>
		</WorkspaceSideTarget>
	);
}
