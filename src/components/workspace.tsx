"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "./api";
import { useApiRevalidation } from "./use-api-revalidation";
import {
	readSavedShare,
	saveShare,
	forgetSavedShare,
	savedShareEvent,
} from "./saved-share-links";
import { ProjectLiveProvider, useProjectUpdates } from "./project-live";
import type { ProjectView } from "./projects";
import {
	WorkspaceIcon,
	MaterialThumbnail,
	useWorkspaceDisclosure,
} from "./workspace-ui";
import { ProductSurface, AppearanceControl } from "./product-surface";
import { ProductBrand } from "./product-brand";
import { WorkspaceStatus } from "./workspace-status";
import { useProductConfirm } from "./product-confirm";
import { useActionLifetime } from "./use-action-lifetime";
import { motionDuration } from "./ui-motion";
import {
	parseWorkspaceView,
	sameWorkspaceContext,
	safeProjectListReturn,
	type WorkspaceView,
} from "./workspace-navigation";
import { useWorkspaceNavigation } from "./use-workspace-navigation";
import type { FileMetadata } from "@/lib/file-metadata";
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
import {
	type FileFilters,
	fileTypes,
	fileSorts,
	filesUrl,
} from "@/lib/archive-filters";
type Asset = {
	id: string;
	filename: string;
	mime: string;
	extension: string;
	byteSize: number;
	uploaderType: string;
	createdAt: string;
	thumbnail?: { version: string; width: number; height: number } | null;
	annotationSummary?: { version: string; count: number } | null;
};
type SelectedAsset = Pick<Asset, "id" | "filename" | "mime" | "extension"> &
	Partial<Asset>;
function formatBytes(value: number) {
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
	return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}
export function Unavailable({ guest = true }: { guest?: boolean }) {
	return (
		<WorkspaceStatus
			guest={guest}
			homeLink
			title={guest ? "链接已不可用" : "项目访问已中断"}
			message={guest ? "请向工程师索取新链接。" : "请返回项目列表重新进入。"}
		/>
	);
}
export function Bootstrap({ token }: { token: string }) {
	const [error, setError] = useState<"unavailable" | "temporary" | null>(null);
	useEffect(() => {
		let active = true;
		void api<{ projectId: string }>("/api/guest/session", "POST", { token })
			.then((result) => {
				if (active)
					window.location.replace(`/s/session?project=${result.projectId}`);
			})
			.catch((failure: unknown) => {
				if (active) {
					window.history.replaceState(null, "", "/s/session");
					setError(
						failure instanceof ApiError &&
							failure.status === 401 &&
							failure.code === "LINK_UNAVAILABLE"
							? "unavailable"
							: "temporary",
					);
				}
			});
		return () => {
			active = false;
		};
	}, [token]);
	if (error === "unavailable") return <Unavailable />;
	if (error === "temporary")
		return (
			<WorkspaceStatus
				guest
				homeLink
				title="暂时无法打开项目"
				message="连接中断或服务暂时不可用，请稍后重新打开原分享链接。"
			/>
		);
	return (
		<WorkspaceStatus
			guest
			title="正在打开项目…"
			message="验证分享权限，请稍候。"
		/>
	);
}
export function Workspace({
	initial,
	guest = false,
}: {
	initial: ProjectView;
	guest?: boolean;
}) {
	return (
		<WorkspaceSession
			key={[guest ? "guest" : "owner", initial.id].join(":")}
			initial={initial}
			guest={guest}
		/>
	);
}
function WorkspaceSession({
	initial,
	guest = false,
}: {
	initial: ProjectView;
	guest?: boolean;
}) {
	const [invalid, setInvalid] = useState(false);
	const onInvalid = useCallback(() => setInvalid(true), []);
	if (invalid) return <Unavailable guest={guest} />;
	return (
		<ProductSurface className="pm-workspace">
			<ProjectLiveProvider
				base={`/api/${guest ? "guest/" : ""}projects/${initial.id}`}
				cursor={initial.syncCursor}
				onInvalid={onInvalid}
			>
				<WorkspaceContent initial={initial} guest={guest} />
			</ProjectLiveProvider>
		</ProductSurface>
	);
}
function WorkspaceContent({
	initial,
	guest = false,
}: {
	initial: ProjectView;
	guest?: boolean;
}) {
	const viewActions = useActionLifetime(initial.id);
	const router = useRouter();
	const searchParams = useSearchParams();
	const [initialView] = useState(() =>
		parseWorkspaceView(new URLSearchParams(searchParams?.toString() ?? "")),
	);
	const returnHref = safeProjectListReturn(searchParams?.get("from") ?? null);
	const [pendingView, setPendingView] = useState<WorkspaceView | null>(
		initialView.fileId ? initialView : null,
	);
	const [locationError, setLocationError] = useState("");
	const [locationAttempt, setLocationAttempt] = useState(0);
	const [selectionRevision, setSelectionRevision] = useState(0);
	const viewAnnotation = useRef(initialView.annotationId);
	const materialPicker = useRef<HTMLInputElement>(null);
	const fileTrail = useRef(new Map<string, Asset>());
	function rememberFile(file: Asset) {
		fileTrail.current.delete(file.id);
		fileTrail.current.set(file.id, file);
		if (fileTrail.current.size > 20) {
			const oldest = fileTrail.current.keys().next().value;
			if (oldest) fileTrail.current.delete(oldest);
		}
	}
	const [imageExportFile, setImageExportFile] = useState<string | null>(null);
	const [packageSelection, setPackageSelection] = useState<
			"pdf" | "zip" | null
		>(null),
		[exportFiles, setExportFiles] = useState<string[]>([]),
		[exportBusy, setExportBusy] = useState(false),
		[exportNotice, setExportNotice] = useState("");
	const pdfSelection = packageSelection === "pdf",
		zipSelection = packageSelection === "zip";
	const [project, setProject] = useState(initial),
		[section, setSection] = useState<WorkspaceView["section"]>(
			initialView.section,
		),
		[assets, setAssets] = useState<Asset[]>([]),
		[cursor, setCursor] = useState<string | null>(null),
		[selected, setSelected] = useState<SelectedAsset | null>(null);
	const [selectedIssue, setSelectedIssue] = useState<string | null>(
			initialView.issueId,
		),
		[issueRefresh, setIssueRefresh] = useState(0);

	const [popupSelection, setPopupSelection] = useState<{
		file: SelectedAsset;
		annotationId: string;
	} | null>(null);
	const [initialAnnotation, setInitialAnnotation] = useState<string>();
	const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
	const [overlayIssue, setOverlayIssue] = useState<string | null>(null);
	const scopedConfirm = useProductConfirm(
		[
			section,
			selected?.id,
			selectedIssue,
			popupSelection?.file.id,
			popupSelection?.annotationId,
		].join(":"),
	);
	const confirm = useCallback(
		(request: Parameters<typeof scopedConfirm>[0]) =>
			scopedConfirm({ ...request, signal: viewActions.signal }),
		[scopedConfirm, viewActions],
	);
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
	const [fileFilters, setFileFilters] = useState<FileFilters>({
		type: initialView.type,
		sort: initialView.sort,
	});
	const archived = !!project.archivedAt;
	const editorDirty = useRef(false),
		deliveryDirty = useRef(false);
	const onDeliveryDirty = useCallback((dirty: boolean) => {
		deliveryDirty.current = dirty;
	}, []);
	const info = useWorkspaceDisclosure();
	const [infoMode, setInfoMode] = useState<"about" | "settings" | "share">(
		"about",
	);
	const infoPanel = useRef<HTMLElement>(null),
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
		viewActions.renew();
		const valid = viewActions.capture();
		if (navigationTimer.current) clearTimeout(navigationTimer.current);
		if (!motionDuration("exit")) {
			action();
			return;
		}
		setChangingView(true);
		navigationTimer.current = setTimeout(() => {
			navigationTimer.current = null;
			if (!valid()) return;
			action();
			setChangingView(false);
		}, motionDuration("exit"));
	}
	const [sideTarget, setSideTarget] = useState<HTMLDivElement | null>(null);
	const contextActive =
		section === "files" &&
		(!!selectedIssue ||
			!!selected?.mime.startsWith("image/") ||
			!!popupSelection);
	const detailId = selectedIssue ?? selected?.id ?? "";
	const previousViewFocus = useRef([section, detailId].join(":"));
	useEffect(() => {
		const key = [section, detailId].join(":");
		if (previousViewFocus.current === key) return;
		previousViewFocus.current = key;
		const frame = requestAnimationFrame(() => {
			const root =
				section === "files"
					? materials.current
					: document.getElementById("workspace-deliveries");
			const heading = root?.querySelector<HTMLElement>(
				section === "files" && detailId ? ".workspace-file-detail h2" : "h2",
			);
			heading?.setAttribute("tabindex", "-1");
			heading?.focus({ preventScroll: true });
		});
		return () => cancelAnimationFrame(frame);
	}, [section, detailId]);
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
				event.target instanceof Element &&
				event.target.closest(".pm-confirm[open]")
			)
				return;
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
				inboxDirty.current ||
				projectDraft.current.dirty
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
	function hasPendingChanges() {
		return (
			editorDirty.current ||
			deliveryDirty.current ||
			overlayDirty.current ||
			inboxDirty.current ||
			projectDraft.current.dirty
		);
	}
	async function requestLeave(leaving = false) {
		const valid = viewActions.capture();
		if (!hasPendingChanges()) return valid();
		const accepted = await confirm({
			title: leaving ? "离开当前项目？" : "有未完成的修改或操作",
			description: leaving
				? "尚未保存的输入和未完成的传输将随本页关闭。已发出的请求可能仍完成。"
				: "切换将保留仍在本页的会话；请留意未保存的输入和未完成的操作。",
			cancelLabel: "继续编辑",
			confirmLabel: leaving ? "放弃并离开" : "仍要继续",
			danger: leaving,
		});
		return accepted && valid();
	}
	function navigateToList(event: { preventDefault: () => void }) {
		if (exportBusy) {
			event.preventDefault();
			return;
		}
		if (!hasPendingChanges()) return;
		event.preventDefault();
		void requestLeave(true).then((accepted) => {
			if (accepted) router.push(returnHref);
		});
	}
	// Browser history remains synchronous: restore the original entry before the framework handles it.
	function allowLeave() {
		return (
			(!editorDirty.current &&
				!deliveryDirty.current &&
				!overlayDirty.current &&
				!inboxDirty.current &&
				!projectDraft.current.dirty) ||
			window.confirm(
				"有未保存或未确认的修改，仍要切换或离开吗？已发出的请求可能仍完成。",
			)
		);
	}
	async function selectFile(file: Asset | null) {
		if (exportBusy) return;
		if (file?.id === selected?.id && !popupSelection && !selectedIssue) return;
		if (
			(selected?.id !== file?.id ||
				selectedIssue ||
				popupSelection ||
				overlayIssue) &&
			!(await requestLeave())
		)
			return;
		if (file) rememberFile(file);
		setPendingView(null);
		changeView(() => {
			viewAnnotation.current = null;
			setSelectedIssue(null);
			setPopupSelection(null);
			setOverlayIssue(null);
			setMobilePanelOpen(false);
			setInitialAnnotation(undefined);
			setSelected(file);
			navigation.write(
				view({
					fileId: file?.id ?? null,
					annotationId: null,
					issueId: null,
					quick: false,
				}),
			);
			if (!file) void load();
		});
	}
	async function selectIssue(id: string) {
		if (selectedIssue !== id && !(await requestLeave())) return;
		setPendingView(null);
		changeView(() => {
			setSelected(null);
			setPopupSelection(null);
			setOverlayIssue(null);
			setMobilePanelOpen(true);
			setSelectedIssue(id);
			navigation.write(
				view({ fileId: null, annotationId: null, issueId: id, quick: false }),
			);
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
	async function openThumbnailAnnotation(file: Asset, annotationId: string) {
		rememberFile(file);
		if (exportBusy) return;
		if (
			popupSelection?.file.id === file.id &&
			popupSelection.annotationId === annotationId &&
			!overlayIssue
		) {
			setMobilePanelOpen(true);
			navigation.write(
				view({ fileId: file.id, annotationId, issueId: null, quick: true }),
			);
			return;
		}
		if (!(await requestLeave())) return;
		setPendingView(null);
		viewAnnotation.current = annotationId;
		if (window.matchMedia("(max-width: 700px)").matches) {
			setPopupSelection({ file, annotationId });
			setOverlayIssue(null);
			setMobilePanelOpen(true);
			navigation.write(
				view({ fileId: file.id, annotationId, issueId: null, quick: true }),
			);
		} else {
			changeView(() => {
				setSelected(file);
				setSelectedIssue(null);
				setPopupSelection(null);
				setOverlayIssue(null);
				setInitialAnnotation(annotationId);
				navigation.write(
					view({ fileId: file.id, annotationId, issueId: null, quick: false }),
				);
			});
		}
	}
	async function selectSection(next: WorkspaceView["section"]) {
		if (exportBusy || next === section) return;
		// Both sections stay mounted; changing only the tab does not discard their drafts.
		changeView(() => {
			setSection(next);
			navigation.write(view({ section: next }));
		});
	}
	const [shareUrl, setShareUrl] = useState(""),
		[shareMessage, setShareMessage] = useState(""),
		[shareBusy, setShareBusy] = useState(false);
	const currentShare = useRef<{ id: string; url: string } | null>(null);
	const savedShareId = project.share?.id,
		savedShareExpiry = project.share?.expiresAt,
		savedShareRevoked = project.share?.revokedAt;
	useEffect(() => {
		if (guest) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		function restore() {
			if (timer) clearTimeout(timer);
			const metadata =
				savedShareId && savedShareExpiry
					? {
							id: savedShareId,
							expiresAt: savedShareExpiry,
							revokedAt: savedShareRevoked ?? null,
						}
					: null;
			const remaining = Date.parse(savedShareExpiry ?? "") - Date.now();
			const valid = remaining > 0 && !savedShareRevoked;
			const remembered = currentShare.current;
			setShareUrl(
				readSavedShare(project.id, metadata, window.location.origin) ||
					(valid && remembered && remembered.id === savedShareId
						? remembered.url
						: ""),
			);
			if (valid)
				timer = setTimeout(restore, Math.min(remaining + 20, 2147483647));
		}
		const cleared = () => {
			currentShare.current = null;
			restore();
		};
		restore();
		window.addEventListener("storage", cleared);
		window.addEventListener(savedShareEvent, cleared);
		return () => {
			if (timer) clearTimeout(timer);
			window.removeEventListener("storage", cleared);
			window.removeEventListener(savedShareEvent, cleared);
		};
	}, [guest, project.id, savedShareId, savedShareExpiry, savedShareRevoked]);
	const [name, setName] = useState(project.name),
		[description, setDescription] = useState(project.description),
		[saving, setSaving] = useState(false);
	const projectDraft = useRef({ dirty: false, revision: project.revision });
	const [projectNotice, setProjectNotice] = useState("");
	const base = `/api/${guest ? "guest/" : ""}projects/${project.id}`;
	const onInvalid = useCallback(() => {
		viewActions.end();
		fileTrail.current.clear();
		if (navigationTimer.current) clearTimeout(navigationTimer.current);
		setInvalid(true);
		setPopupSelection(null);
		setOverlayIssue(null);
		setMobilePanelOpen(false);
		setAssets([]);
		setSelected(null);
		setSelectedIssue(null);
		setPendingView(null);
		setShareUrl("");
		currentShare.current = null;
		forgetSavedShare(initial.id);
	}, [initial.id, viewActions]);
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
	const filesShown = useRef(section === "files");
	filesShown.current = section === "files";
	const fileListReading = useRef(false);
	const [fileListEpoch, setFileListEpoch] = useState(0);
	const fileReading = useRef<AbortController | null>(null);
	const load = useCallback(async () => {
		if (!filesShown.current) return;
		fileListReading.current = true;
		const run = ++fileLoadRun.current;
		fileReading.current?.abort();
		const controller = new AbortController();
		fileReading.current = controller;
		setLoading(true);
		setPaging(false);
		try {
			const result = await api<{ items: Asset[]; nextCursor: string | null }>(
				filesUrl(base, fileFilters),
				"GET",
				undefined,
				{ signal: controller.signal },
			);
			if (run !== fileLoadRun.current) return;
			setAssets(result.items);
			setCursor(result.nextCursor);
			setError("");
		} catch (e) {
			if (run === fileLoadRun.current) failure(e);
		} finally {
			if (run === fileLoadRun.current) {
				fileListReading.current = false;
				setLoading(false);
				setFileListEpoch((value) => value + 1);
			}
		}
	}, [base, failure, fileFilters]);
	useEffect(() => {
		if (section === "files") void load();
		else {
			setLoading(false);
			setPaging(false);
		}
		return () => {
			fileListReading.current = false;
			fileLoadRun.current++;
			fileReading.current?.abort();
		};
	}, [load, section]);
	useApiRevalidation(() => {
		if (!selected && !selectedIssue) void load();
	});
	useProjectUpdates((updates) => {
		if (updates.some((e) => e.kind === "file.changed" || e.kind === "resync")) {
			fileTrail.current.clear();
			void load();
		}
		for (const event of updates)
			if (
				(event.kind === "annotation.changed" ||
					event.kind === "issue.changed") &&
				event.fileId
			)
				annotationsSaved(event.fileId);
		if (updates.some((e) => e.kind === "issue.changed" || e.kind === "resync"))
			issueUpdated();
		if (
			updates.some(
				(e) =>
					e.kind === "project.changed" ||
					e.kind === "access.changed" ||
					e.kind === "resync",
			)
		) {
			void api<ProjectView>(base)
				.then((data) => {
					setProject((old) =>
						old.revision > data.revision ? old : { ...old, ...data },
					);
					if (data.revision <= projectDraft.current.revision) return;
					if (projectDraft.current.dirty)
						setProjectNotice(
							"项目说明已在别处更新；当前输入已保留，保存时检查冲突。",
						);
					else {
						setName(data.name);
						setDescription(data.description);
						projectDraft.current.revision = data.revision;
					}
				})
				.catch(failure);
		}
	});

	async function rotate() {
		if (
			project.share &&
			!project.share.revokedAt &&
			!(await confirm({
				title: "重新生成客户链接？",
				description:
					"旧链接及客户会话将失效。请将新链接重新交给需要访问的客户。",
				confirmLabel: "重新生成",
				danger: true,
			}))
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
			currentShare.current = result.url
				? { id: result.id, url: result.url }
				: null;
			const retained = result.url
				? saveShare(
						project.id,
						{ id: result.id, expiresAt: result.expiresAt, revokedAt: null },
						result.url,
					)
				: false;
			setShareMessage(
				result.url
					? retained
						? "链接已生成，本浏览器刷新后可继续复制，撤销或过期后移除。"
						: "链接已生成；浏览器未允许保存，请复制留存。"
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
				filesUrl(base, fileFilters, cursor),
				"GET",
				undefined,
				{ signal },
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
	async function changeFileFilters(next: FileFilters) {
		if (exportBusy || !(await requestLeave())) return false;
		setExportFiles([]);
		if (packageSelection) setExportNotice("筛选已改变，请重新选择导出资料。");
		setSelected(null);
		setSelectedIssue(null);
		setPopupSelection(null);
		setPendingView(null);
		setOverlayIssue(null);
		setMobilePanelOpen(false);
		setAssets([]);
		setCursor(null);
		setFileFilters(next);
		navigation.write(
			view({
				...next,
				fileId: null,
				annotationId: null,
				issueId: null,
				quick: false,
			}),
			true,
		);
		return true;
	}
	function view(patch: Partial<WorkspaceView> = {}): WorkspaceView {
		if (pendingView) return { ...pendingView, ...fileFilters, section, ...patch };
		return {
			...fileFilters,
			section,
			fileId:
				selected?.id ??
				(mobilePanelOpen ? popupSelection?.file.id : null) ??
				null,
			annotationId: viewAnnotation.current,
			issueId: selectedIssue,
			quick: !!popupSelection && mobilePanelOpen,
			...patch,
		};
	}
	function restoreView(target: WorkspaceView) {
		const sectionOnly = sameWorkspaceContext(target, view());
		viewActions.renew();
		if (navigationTimer.current) clearTimeout(navigationTimer.current);
		setChangingView(false);
		setSection(target.section);
		setFileFilters((old) =>
			old.type === target.type && old.sort === target.sort
				? old
				: { type: target.type, sort: target.sort },
		);
		if (sectionOnly) {
			setPendingView(old => old ? target : null);
			return;
		}
		viewAnnotation.current = target.annotationId;
		if (target.issueId) {
			setSelected(null);
			setPopupSelection(null);
			setOverlayIssue(null);
			setSelectedIssue(target.issueId);
			setMobilePanelOpen(true);
			setPendingView(null);
			return;
		}
		if (!target.fileId) {
			setSelected(null);
			setPopupSelection(null);
			setSelectedIssue(null);
			setOverlayIssue(null);
			setMobilePanelOpen(false);
			setPendingView(null);
			return;
		}
		const file =
			assets.find((item) => item.id === target.fileId) ??
			(selected?.id === target.fileId ? selected : null) ??
			(popupSelection?.file.id === target.fileId
				? popupSelection.file
				: null) ??
			fileTrail.current.get(target.fileId) ??
			null;
		if (!file) {
			setSelected(null);
			setSelectedIssue(null);
			setPopupSelection(null);
			setOverlayIssue(null);
			setMobilePanelOpen(false);
			setPendingView(target);
			return;
		}
		applyFileView(target, file);
	}
	const applyFileView = useCallback(
		(target: WorkspaceView, file: SelectedAsset) => {
			setPendingView(null);
			setLocationError("");
			setSelectedIssue(null);
			setOverlayIssue(null);
			viewAnnotation.current = target.annotationId;
			setInitialAnnotation(target.annotationId ?? undefined);
			setSelectionRevision((value) => value + 1);
			if (
				target.quick &&
				target.annotationId &&
				window.matchMedia("(max-width: 700px)").matches
			) {
				setSelected(null);
				// A URL-only reference has no invented size/date/uploader; its annotation read has already checked access.
				setPopupSelection({ file, annotationId: target.annotationId });
				setMobilePanelOpen(true);
			} else {
				setSelected(file);
				setPopupSelection(null);
				setMobilePanelOpen(!!target.annotationId);
			}
		},
		[],
	);
	const navigation = useWorkspaceNavigation({
		scope: base,
		guest,
		canLeave: (destination) => {
			const target = parseWorkspaceView(destination.searchParams);
			const local =
				destination.pathname ===
					(guest ? "/s/session" : `/projects/${project.id}`) &&
				(!guest || destination.searchParams.get("project") === project.id);
			return (
				!exportBusy &&
				((local && sameWorkspaceContext(target, view())) || allowLeave())
			);
		},
		travel: () => viewActions.renew(),
		restore: restoreView,
	});
	useEffect(() => {
		void fileListEpoch;
		void locationAttempt;
		if (!pendingView || section !== "files")
			return;
		if (pendingView.issueId) {
			setSelectedIssue(pendingView.issueId);
			setPendingView(null);
			return;
		}
		const fileId = pendingView.fileId;
		if (!fileId) {
			setPendingView(null);
			return;
		}
		const file = assets.find((item) => item.id === fileId);
		if (file) {
			applyFileView(pendingView, file);
			return;
		}
		const controller = new AbortController();
		const valid = viewActions.capture();
		setLocationError("");
		void api<FileMetadata>(
			`${base}/files/${fileId}`,
			"GET",
			undefined,
			{ signal: controller.signal, cacheMs: 0 },
		)
			.then((file) => {
				if (controller.signal.aborted || !valid()) return;
				if (file.id !== fileId)
					throw new Error("资料定位结果不一致，请重新选择。");
				applyFileView(pendingView, file);
			})
			.catch((error) => {
				if (controller.signal.aborted || !valid()) return;
				if (error instanceof ApiError && error.status === 401) onInvalid();
				else
					setLocationError(
						error instanceof ApiError && [403, 404].includes(error.status)
							? "这项资料不存在或无权访问，请重新选择或向工程师确认。"
							: "资料定位暂未完成，可以重试；当前筛选和其他输入已保留。",
					);
			});
		return () => controller.abort();
	}, [
		pendingView,
		assets,
		base,
		onInvalid,
		applyFileView,
		section,
		fileListEpoch,
		locationAttempt,
		viewActions,
	]);
	function showInfo(mode: typeof infoMode, trigger: HTMLButtonElement) {
		infoTrigger.current = trigger;
		if (info.expanded && infoMode === mode) info.hide();
		else {
			setInfoMode(mode);
			info.show();
		}
	}
	useEffect(() => {
		if (!info.expanded) return;
		const frame = requestAnimationFrame(() => {
			if (infoMode === "share")
				infoPanel.current
					?.querySelector<HTMLElement>(".workspace-share-section")
					?.scrollIntoView({ block: "nearest", behavior: "instant" });
			else infoPanel.current?.focus({ preventScroll: true });
		});
		return () => cancelAnimationFrame(frame);
	}, [info.expanded, infoMode]);
	function closeContext() {
		setMobilePanelOpen(false);
		if (popupSelection)
			navigation.write(
				view({ fileId: null, annotationId: null, issueId: null, quick: false }),
				true,
			);
	}
	if (invalid) return <Unavailable guest={guest} />;
	return (
		<WorkspaceSideTarget value={sideTarget}>
			<ProjectReadOnly.Provider value={archived}>
				<main
					className="workspace workspace-redesign"
					onKeyDown={(event) => {
						if (event.key === "Escape" && event.target instanceof HTMLElement) {
							const menu = event.target.closest<HTMLDetailsElement>(
								".workspace-file-menu[open]",
							);
							if (menu) {
								event.preventDefault();
								menu.open = false;
								menu.querySelector("summary")?.focus();
								return;
							}
						}
						if (event.key === "Escape" && info.mounted) {
							info.hide();
							infoTrigger.current?.focus();
						}
					}}
				>
					<a className="pm-skip" href="#workspace-content">
						跳到项目内容
					</a>
					<header className="workspace-topbar">
						<div className="workspace-identity">
							<ProductBrand
								href={returnHref}
								passive={guest}
								onNavigate={navigateToList}
							/>
							<nav className="workspace-breadcrumb" aria-label="当前位置">
								{!guest ? (
									<>
										<Link
											href={returnHref}
											prefetch={false}
											onNavigate={navigateToList}
										>
											我的项目
										</Link>
										<span aria-hidden="true">/</span>
									</>
								) : null}
								<h1>{project.name}</h1>
							</nav>
						</div>
						<div className="workspace-header-actions">
							<AppearanceControl />
							{!guest ? (
								<>
									<button
										type="button"
										onClick={(event) => showInfo("share", event.currentTarget)}
									>
										分享项目
									</button>
									<button
										type="button"
										onClick={(event) =>
											showInfo("settings", event.currentTarget)
										}
									>
										项目设置
									</button>
								</>
							) : (
								<button
									type="button"
									onClick={(event) => showInfo("about", event.currentTarget)}
									aria-expanded={info.expanded}
								>
									项目说明
								</button>
							)}
						</div>
						{info.mounted ? (
							<section
								ref={infoPanel}
								tabIndex={-1}
								aria-label="项目说明与分享设置"
								className="workspace-project-info"
								id="workspace-project-info"
								data-phase={info.phase}
								inert={info.phase === "closing"}
							>
								<p className="eyebrow">
									{guest
										? "客户资料协作 · 无需注册 · 仅此项目"
										: "工程师工作台"}
								</p>
								<div className="workspace-info-heading">
									<h2>项目说明</h2>
									<button
										type="button"
										aria-label="关闭项目说明"
										onClick={() => {
											info.hide();
											infoTrigger.current?.focus();
										}}
									>
										×
									</button>
								</div>
								<p className="preserve-lines">
									{project.description || "请上传零件照片或现有工程资料。"}
								</p>
								{!guest ? (
									<details
										className="project-settings"
										open={infoMode !== "about"}
										onToggle={(event) => {
											if (!event.currentTarget.open && infoMode !== "about")
												setInfoMode("about");
											else if (event.currentTarget.open && infoMode === "about")
												setInfoMode("settings");
										}}
									>
										<summary>编辑说明与分享</summary>
										<div className="project-settings-content">
											<ArchiveProjectButton
												project={project}
												beforeChange={() => requestLeave()}
												onSaved={(updated) => {
													setProject((old) =>
														old.revision > updated.revision
															? old
															: { ...old, ...updated },
													);
													if (!projectDraft.current.dirty)
														projectDraft.current.revision = updated.revision;
												}}
											/>
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
														projectDraft.current = {
															dirty: false,
															revision: updated.revision,
														};
														setName(updated.name);
														setDescription(updated.description);
														setProjectNotice("");
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
														onChange={(e) => {
															projectDraft.current.dirty = true;
															setName(e.target.value);
														}}
													/>
												</label>
												<label>
													项目说明
													<textarea
														value={description}
														maxLength={4000}
														disabled={saving || archived}
														onChange={(e) => {
															projectDraft.current.dirty = true;
															setDescription(e.target.value);
														}}
													/>
												</label>
												{projectNotice ? (
													<p role="status">
														{projectNotice}{" "}
														<button
															type="button"
															disabled={saving}
															onClick={async () => {
																if (
																	await confirm({
																		title: "载入最新项目说明？",
																		description:
																			"将放弃当前尚未保存的说明输入，载入已收到的最新版本。",
																		cancelLabel: "继续编辑",
																		confirmLabel: "放弃并载入",
																		danger: true,
																	})
																) {
																	setName(project.name);
																	setDescription(project.description);
																	projectDraft.current = {
																		dirty: false,
																		revision: project.revision,
																	};
																	setProjectNotice("");
																}
															}}
														>
															载入最新说明
														</button>
													</p>
												) : null}
												<button type="submit" disabled={saving || archived}>
													{saving ? "保存中…" : "保存项目说明"}
												</button>
											</form>
											<h2 className="workspace-share-section">客户分享链接</h2>
											<p className="muted">
												持链接者可查看客户可见资料、上传和下载；归档期间只读。有效期
												30 天，可随时撤销。请只发给协作人员。
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
																!(await confirm({
																	title: "撤销客户分享？",
																	description:
																		"旧链接与客户会话将失效；已下载副本无法收回。",
																	confirmLabel: "撤销分享",
																	danger: true,
																}))
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
														? shareUrl
															? "当前链接有效，可随时复制。"
															: "此浏览器未保留当前链接地址；可重新生成并保留新链接。"
														: "尚无有效分享链接。")}
											</p>
										</div>
									</details>
								) : null}
							</section>
						) : null}
					</header>
					<nav className="workspace-section-tabs" aria-label="项目工作区">
						<button
							type="button"
							aria-pressed={section === "files"}
							aria-controls="workspace-materials"
							disabled={exportBusy}
							onClick={() => selectSection("files")}
						>
							资料与补测
						</button>
						<button
							type="button"
							aria-pressed={section === "deliveries"}
							aria-controls="workspace-deliveries"
							disabled={exportBusy}
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
					{archived ? (
						<p className="workspace-archive-notice" role="status">
							项目已归档：仅可查看和下载，恢复后可继续编辑。
							{!guest ? "可在项目说明中恢复或撤销分享。" : "请联系工程师恢复。"}
						</p>
					) : null}
					<IssueInbox
						key={base}
						base={base}
						guest={guest}
						refreshKey={issueRefresh}
						onInvalid={onInvalid}
						onUpdated={issueUpdated}
						onDirty={onInboxDirty}
					/>
					<div
						className="workspace-panels"
						data-changing={changingView}
						data-section={section}
						data-editing={!!selected || !!selectedIssue}
						data-context-active={contextActive}
						id="workspace-content"
						inert={changingView}
					>
						<aside
							className="workspace-file-rail"
							hidden={!selected || section !== "files"}
							aria-label="当前资料定位"
						>
							<button
								type="button"
								className="text-button"
								onClick={() => selectFile(null)}
							>
								‹ 返回资料
							</button>
							<h2>当前资料</h2>
							<ul>
								{assets.map((file) => (
									<li key={file.id}>
										<button
											type="button"
											aria-pressed={selected?.id === file.id}
											disabled={exportBusy}
											onClick={() => selectFile(file)}
										>
											{file.mime.startsWith("image/") && file.thumbnail ? (
												<MaterialThumbnail
													defer
													src={`${base}/files/${file.id}/preview?variant=320`}
													version={file.thumbnail.version}
													name={file.filename}
												/>
											) : (
												<WorkspaceIcon kind="file" />
											)}
											<span>
												{file.filename}
												<small>{file.extension.toUpperCase()}</small>
											</span>
										</button>
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
						</aside>
						<section
							ref={materials}
							className="workspace-materials"
							id="workspace-materials"
							hidden={section !== "files"}
							aria-label="资料与补测"
							data-mobile-active={section === "files"}
						>
							<header
								className="workspace-section-heading"
								hidden={!!selected || !!selectedIssue}
							>
								<div>
									<h2>项目资料</h2>
									<p className="muted">
										照片用于定位与标注，其他附件保留原文件下载。
									</p>
								</div>
								<button
									type="button"
									className="primary"
									disabled={archived}
									onClick={() => materialPicker.current?.click()}
								>
									<WorkspaceIcon kind="upload" />
									上传资料
								</button>
							</header>
							<div hidden={!!selected || !!selectedIssue}>
								<div className="workspace-file-filters">
									<label>
										类型{" "}
										<select
											disabled={exportBusy}
											value={fileFilters.type}
											onChange={(event) =>
												changeFileFilters({
													...fileFilters,
													type: event.target.value as FileFilters["type"],
												})
											}
										>
											{Object.entries(fileTypes).map(([value, label]) => (
												<option key={value} value={value}>
													{label}
												</option>
											))}
										</select>
									</label>
									<label>
										排序{" "}
										<select
											disabled={exportBusy}
											value={fileFilters.sort}
											onChange={(event) =>
												changeFileFilters({
													...fileFilters,
													sort: event.target.value as FileFilters["sort"],
												})
											}
										>
											{Object.entries(fileSorts).map(([value, label]) => (
												<option key={value} value={value}>
													{label}
												</option>
											))}
										</select>
									</label>
									{!packageSelection ? (
										<>
											<button
												type="button"
												onClick={async () => {
													if (fileFilters.type !== "image") {
														if (
															!(await changeFileFilters({
																...fileFilters,
																type: "image",
															}))
														)
															return;
													} else if (!(await requestLeave())) return;
													setPackageSelection("pdf");
													setExportFiles([]);
													setExportNotice(
														"在下方勾选1–8张照片，按选择顺序生成PDF。",
													);
												}}
											>
												PDF资料报告
											</button>
											<button
												type="button"
												onClick={async () => {
													if (!(await requestLeave())) return;
													setPackageSelection("zip");
													setExportFiles([]);
													setExportNotice(
														"在下方勾选最多20项资料，可附加所选已发布附件。",
													);
												}}
											>
												ZIP资料包
											</button>
										</>
									) : null}
								</div>
								{pdfSelection ? (
									<div className="workspace-pdf-selection">
										<p role="status">
											已选 {exportFiles.length} / 8 张。{exportNotice}
										</p>
										{exportFiles[0] ? (
											<AnnotatedImageExport
												key={base}
												base={base}
												fileId={exportFiles[0]}
												fileIds={exportFiles}
												reportOnly
												onInvalid={onInvalid}
												onBusyChange={setExportBusy}
												onClose={() => {
													setPackageSelection(null);
													setExportFiles([]);
												}}
											/>
										) : (
											<>
												<button type="button" disabled>
													生成PDF（请先勾选照片）
												</button>
												<button
													type="button"
													onClick={() => setPackageSelection(null)}
												>
													取消选择
												</button>
											</>
										)}
									</div>
								) : null}
								{zipSelection ? (
									<div className="workspace-pdf-selection">
										<p role="status">
											已选资料 {exportFiles.length} / 20。{exportNotice}
										</p>
										<ZipPackageExport
											key={base}
											base={base}
											guest={guest}
											materialIds={exportFiles}
											onInvalid={onInvalid}
											onBusyChange={setExportBusy}
											onClose={() => {
												setPackageSelection(null);
												setExportFiles([]);
											}}
										/>
									</div>
								) : null}
								{pendingView ? (
									<div className="workspace-location-status" role={locationError ? "alert" : "status"}>
										<p>{locationError || "正在定位资料…"}</p>
										{locationError ? <button type="button" onClick={() => setLocationAttempt(value => value + 1)}>重试定位</button> : null}
									</div>
								) : null}
								{loading ? (
									<p role="status">加载资料…</p>
								) : assets.length === 0 && !error ? (
									<p className="empty">当前类型下暂无资料，可调整筛选条件。</p>
								) : null}
								<ul className="workspace-gallery">
									{assets.map((file) => (
										<li key={file.id}>
											{zipSelection ? (
												<label className="workspace-pdf-checkbox">
													<input
														type="checkbox"
														checked={exportFiles.includes(file.id)}
														disabled={
															exportBusy ||
															(!exportFiles.includes(file.id) &&
																exportFiles.length >= 20)
														}
														onChange={(event) => {
															const checked = event.target.checked;
															setExportFiles((ids) =>
																checked
																	? ids.length < 20
																		? [...ids, file.id]
																		: ids
																	: ids.filter((id) => id !== file.id),
															);
														}}
													/>
													选入ZIP：{file.filename}
												</label>
											) : null}
											{file.mime.startsWith("image/") ? (
												<div className="workspace-asset">
													{pdfSelection ? (
														<label className="workspace-pdf-checkbox">
															<input
																type="checkbox"
																checked={exportFiles.includes(file.id)}
																disabled={
																	exportBusy ||
																	(!exportFiles.includes(file.id) &&
																		exportFiles.length >= 8)
																}
																onChange={(event) => {
																	const checked = event.target.checked;
																	setExportFiles((ids) =>
																		checked
																			? ids.length < 8
																				? [...ids, file.id]
																				: ids
																			: ids.filter((id) => id !== file.id),
																	);
																}}
															/>
															选入PDF：{file.filename}
														</label>
													) : null}
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
													<strong className="workspace-image-name">
														{file.filename}
													</strong>
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
															{file.uploaderType === "owner"
																? "工程师"
																: "客户"}
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
								key={selectedIssue ?? selected?.id ?? "gallery"}
								data-view-key={selectedIssue ?? selected?.id}
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
											<span className="workspace-editor-kind">
												{selected.mime.startsWith("image/") ? (guest ? "只读标注 · 可补充测量" : "照片标注") : "附件资料"}
											</span>
											<details className="workspace-file-menu">
												<summary aria-label="文件操作">···</summary>
												<div className="workspace-file-menu-items">
													{selected.mime.startsWith("image/") ? (
														<button
															type="button"
															onClick={(event) => {
																setImageExportFile(selected.id);
																event.currentTarget
																	.closest("details")
																	?.removeAttribute("open");
															}}
														>
															导出图片／PDF
														</button>
													) : null}
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
																if (!(await requestLeave())) return;
																if (
																	!(await confirm({
																		title: `隐藏“${selected.filename}”？`,
																		description:
																			"文件将从当前资料列表隐藏，原件和必要历史仍保留。",
																		confirmLabel: "隐藏文件",
																		danger: true,
																	}))
																)
																	return;
																try {
																	await api(
																		`${base}/files/${selected.id}`,
																		"DELETE",
																	);
																	fileTrail.current.delete(selected.id);
																	setSelected((current) =>
																		current?.id === selected.id
																			? null
																			: current,
																	);
																	const location = new URL(
																		window.location.href,
																	);
																	const currentView = parseWorkspaceView(
																		location.searchParams,
																	);
																	if (currentView.fileId === selected.id) {
																		viewAnnotation.current = null;
																		navigation.write(
																			{
																				...currentView,
																				fileId: null,
																				annotationId: null,
																				issueId: null,
																				quick: false,
																			},
																			true,
																		);
																	}
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
											imageExportFile === selected.id ? (
												<AnnotatedImageExport
													key={selected.id}
													base={base}
													fileId={selected.id}
													onInvalid={onInvalid}
													onClose={() => setImageExportFile(null)}
												/>
											) : null
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
												selectionRevision={selectionRevision}
												onSelectionChange={(id) => {
													viewAnnotation.current = id;
													navigation.write(view({ annotationId: id }), true);
												}}
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
								pickerRef={materialPicker}
								floating
								onReady={() => void load()}
								onInvalid={onInvalid}
							/>
						</section>
						<aside
							className="workspace-deliveries"
							id="workspace-deliveries"
							hidden={section !== "deliveries"}
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
							<div>
								<DeliverySection
									active={section === "deliveries"}
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
							onClose={closeContext}
							targetRef={setSideTarget}
						/>
					</div>
				</main>
			</ProjectReadOnly.Provider>
		</WorkspaceSideTarget>
	);
}
