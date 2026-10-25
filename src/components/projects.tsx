"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { api } from "./api";
import { projectStatuses } from "@/lib/archive-filters";
import { ArchiveProjectButton } from "./archive-project-button";
import { useApiRevalidation } from "./use-api-revalidation";
import type { FolderSummary } from "@/lib/project-folders";
import { prefersReducedMotion, useProjectDialog } from "./projects-motion";
import {
	defaultProjectTheme,
	folderColors,
	projectThemeStyle,
	projectWorkspaceHref,
	rippleGeometry,
	type Folder,
	type FolderColor,
	type RippleOrigin,
} from "./projects-theme";
import "./projects.css";

export type ProjectView = {
	syncCursor?: string;
	id: string;
	name: string;
	description: string;
	revision: number;
	createdAt: string;
	archivedAt?: string | null;
	folderId?: string | null;
	folder?: FolderSummary | null;
	share?: { id: string; expiresAt: string; revokedAt: string | null } | null;
};
function ProjectIcon({
	kind,
}: {
	kind: "folder" | "all" | "plus" | "menu" | "search";
}) {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.7"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{kind === "folder" ? (
				<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z" />
			) : null}
			{kind === "all" ? (
				<>
					<rect x="3" y="3" width="7" height="7" rx="1" />
					<rect x="14" y="3" width="7" height="7" rx="1" />
					<rect x="3" y="14" width="7" height="7" rx="1" />
					<rect x="14" y="14" width="7" height="7" rx="1" />
				</>
			) : null}
			{kind === "plus" ? <path d="M12 5v14M5 12h14" /> : null}
			{kind === "search" ? (
				<>
					<circle cx="10.5" cy="10.5" r="6.5" />
					<path d="m16 16 4.5 4.5" />
				</>
			) : null}
			{kind === "menu" ? (
				<>
					<rect x="3" y="4" width="18" height="16" rx="2" />
					<path d="M9 4v16" />
				</>
			) : null}
		</svg>
	);
}
export function Logout() {
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	return (
		<>
			<button
				type="button"
				disabled={busy}
				onClick={async () => {
					setBusy(true);
					setError("");
					try {
						await api("/api/auth/logout", "POST");
						window.location.assign("/login");
					} catch {
						setError("退出未完成，请重试。");
						setBusy(false);
					}
				}}
			>
				{busy ? "退出中…" : "退出登录"}
			</button>
			{error ? (
				<span className="error" role="alert">
					{error}
				</span>
			) : null}
		</>
	);
}
function FolderSidebar({
	folders,
	selected,
	select,
	add,
	close,
	query,
	setQuery,
	searchOpen,
	setSearchOpen,
	submitSearch,
}: {
	folders: Folder[];
	selected: string;
	select: (id: string, source?: HTMLElement) => void;
	add: () => void;
	close?: () => void;
	query: string;
	setQuery: (query: string) => void;
	searchOpen: boolean;
	setSearchOpen: (open: boolean) => void;
	submitSearch: () => void;
}) {
	const searchId = useId();
	const input = useRef<HTMLInputElement>(null);
	const focusFrame = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
		},
		[],
	);
	function toggleSearch() {
		setSearchOpen(!searchOpen);
		if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
		if (!searchOpen)
			focusFrame.current = requestAnimationFrame(() => {
				input.current?.focus({ preventScroll: true });
				focusFrame.current = null;
			});
	}
	return (
		<>
			<div className="projects-sidebar-heading">
				<a className="brand" href="/projects">
					PartMeasure
				</a>
				{close ? (
					<button
						type="button"
						className="projects-icon-button"
						onClick={close}
						aria-label="关闭文件夹"
					>
						×
					</button>
				) : null}
			</div>
			<nav className="projects-folders" aria-label="项目分类">
				<button
					type="button"
					className="projects-folder"
					aria-pressed={selected === ""}
					data-folder-id=""
					onClick={(event) => select("", event.currentTarget)}
				>
					<ProjectIcon kind="all" />
					<span>全部</span>
				</button>
				<div className="projects-folder-heading">
					<span>文件夹</span>
					<div className="projects-folder-actions">
						<button type="button" onClick={add} aria-label="新建文件夹">
							<ProjectIcon kind="plus" />
						</button>
						<button
							type="button"
							onClick={toggleSearch}
							aria-label="搜索项目"
							aria-expanded={searchOpen}
							aria-controls={searchId}
						>
							<ProjectIcon kind="search" />
						</button>
					</div>
				</div>
				<div
					id={searchId}
					className={`projects-search${searchOpen ? " is-open" : ""}`}
					inert={!searchOpen}
					aria-hidden={!searchOpen}
				>
					<search className="projects-search-form" aria-label="项目搜索">
						<form
							onSubmit={(event) => {
								event.preventDefault();
								input.current?.blur();
								submitSearch();
							}}
						>
							<input
								ref={input}
								type="search"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								aria-label="搜索项目名称或说明"
								placeholder="搜索项目名称或说明"
								enterKeyHint="search"
								autoComplete="off"
							/>
						</form>
					</search>
				</div>
				{folders.map((folder) => (
					<button
						type="button"
						key={folder.id}
						className="projects-folder"
						style={projectThemeStyle(folder.color)}
						data-folder-id={folder.id}
						aria-pressed={selected === folder.id}
						onClick={(event) => select(folder.id, event.currentTarget)}
					>
						<ProjectIcon kind="folder" />
						<span>{folder.name}</span>
					</button>
				))}
				{folders.length === 0 ? (
					<p className="projects-folder-empty">按客户或零件类型创建文件夹。</p>
				) : null}
			</nav>
			<footer className="projects-sidebar-footer">
				<p>文件夹仅对当前账号可见。</p>
				<Logout />
			</footer>
		</>
	);
}
export function Projects({
	initial,
	initialCursor,
	initialError,
	initialFolders,
	initialFolderError,
}: {
	initial: ProjectView[];
	initialCursor: string | null;
	initialError: string;
	initialFolders: Folder[];
	initialFolderError: string;
}) {
	const [items, setItems] = useState(initial),
		[cursor, setCursor] = useState(initialCursor),
		[error, setError] = useState(initialError);
	const [loading, setLoading] = useState(false),
		[busy, setBusy] = useState(false),
		[createError, setCreateError] = useState("");
	const [name, setName] = useState(""),
		[description, setDescription] = useState(""),
		[key, setKey] = useState("");
	const [folders, setFolders] = useState<Folder[]>(initialFolders),
		[selected, setSelected] = useState(""),
		[projectFolder, setProjectFolder] = useState("");
	const [folderBusy, setFolderBusy] = useState(false);
	const [folderLoadError, setFolderLoadError] = useState(initialFolderError);
	const folderWrite = useRef(false);
	const [folderKey, setFolderKey] = useState("");
	const [folderName, setFolderName] = useState(""),
		[folderError, setFolderError] = useState("");
	const [folderDescription, setFolderDescription] = useState("");
	const [folderColor, setFolderColor] = useState<FolderColor>("blue");
	const [query, setQuery] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [status, setStatus] = useState<keyof typeof projectStatuses>("active");
	const [matchCount, setMatchCount] = useState<number | null>(null);
	const listRun = useRef(0);
	const listReading = useRef<AbortController | null>(null);
	const listCursor = useRef(cursor);
	listCursor.current = cursor;
	const filterKey = JSON.stringify([selected, query.trim(), status]);
	const initialFilter = useRef(filterKey);
	const [loadedFilter, setLoadedFilter] = useState(filterKey);
	const createDialog = useProjectDialog(),
		folderDialog = useProjectDialog(),
		drawer = useProjectDialog();
	const background = useRef<HTMLDivElement>(null),
		ripple = useRef<HTMLDivElement>(null),
		content = useRef<HTMLDivElement>(null);
	const rippleAnimation = useRef<Animation | null>(null),
		contentAnimation = useRef<Animation | null>(null);
	const rippleVersion = useRef(0);
	const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const shell = useRef<HTMLDivElement>(null);
	const lastPaint = useRef<string>(defaultProjectTheme.page);
	const activeFolder = folders.find((folder) => folder.id === selected);
	const visible = loadedFilter === filterKey ? items : [];
	const refreshing = loading || loadedFilter !== filterKey;
	const searching = query.trim().length > 0;
	const contentKey = `${selected}:${visible.map((project) => project.id).join(":")}`;
	const lastContentKey = useRef("");
	useEffect(
		() => () => {
			rippleAnimation.current?.cancel();
			contentAnimation.current?.cancel();
			if (selectionTimer.current) clearTimeout(selectionTimer.current);
		},
		[],
	);
	useEffect(() => {
		const viewport = window.visualViewport;
		function resize() {
			shell.current?.style.setProperty(
				"--projects-viewport-height",
				`${viewport?.height ?? window.innerHeight}px`,
			);
			shell.current?.style.setProperty(
				"--projects-viewport-top",
				`${viewport?.offsetTop ?? 0}px`,
			);
		}
		resize();
		viewport?.addEventListener("resize", resize, { passive: true });
		viewport?.addEventListener("scroll", resize, { passive: true });
		window.addEventListener("resize", resize, { passive: true });
		return () => {
			viewport?.removeEventListener("resize", resize);
			viewport?.removeEventListener("scroll", resize);
			window.removeEventListener("resize", resize);
		};
	}, []);
	useLayoutEffect(() => {
		if (lastContentKey.current === contentKey) return;
		lastContentKey.current = contentKey;
		const node = content.current;
		if (!node || prefersReducedMotion()) return;
		contentAnimation.current?.cancel();
		contentAnimation.current = node.animate(
			[{ transform: "translateY(6px)" }, { transform: "translateY(0)" }],
			{ duration: 240, easing: "cubic-bezier(.22,1,.36,1)" },
		);
	}, [contentKey]);
	function paint(color: FolderColor | undefined, origin: RippleOrigin) {
		const base = background.current,
			circle = ripple.current;
		if (!base || !circle) return;
		const version = ++rippleVersion.current;
		rippleAnimation.current?.cancel();
		base.style.backgroundColor = lastPaint.current;
		const next = color ? folderColors[color].page : defaultProjectTheme.page;
		lastPaint.current = next;
		if (prefersReducedMotion()) {
			base.style.backgroundColor = next;
			circle.hidden = true;
			circle.style.willChange = "auto";
			rippleAnimation.current = null;
			return;
		}
		const geometry = rippleGeometry(
			window.innerWidth,
			window.innerHeight,
			origin,
		);
		Object.assign(circle.style, {
			backgroundColor: next,
			willChange: "clip-path",
		});
		circle.hidden = false;
		const animation = circle.animate(
			[
				{ clipPath: `circle(0px at ${geometry.x}px ${geometry.y}px)` },
				{
					clipPath: `circle(${geometry.radius}px at ${geometry.x}px ${geometry.y}px)`,
				},
			],
			{ duration: 560, easing: "cubic-bezier(.2,.75,.25,1)", fill: "forwards" },
		);
		rippleAnimation.current = animation;
		animation.onfinish = () => {
			if (rippleVersion.current !== version) return;
			base.style.backgroundColor = next;
			circle.hidden = true;
			circle.style.willChange = "auto";
			animation.cancel();
			rippleAnimation.current = null;
		};
	}
	function chooseFolder(id: string, origin: RippleOrigin, color?: FolderColor) {
		paint(color, origin);
		if (selectionTimer.current) clearTimeout(selectionTimer.current);
		contentAnimation.current?.cancel();
		if (!content.current || prefersReducedMotion()) {
			setSelected(id);
			return;
		}
		const animation = content.current.animate(
			[{ transform: "translateY(0)" }, { transform: "translateY(5px)" }],
			{ duration: 90 },
		);
		contentAnimation.current = animation;
		selectionTimer.current = setTimeout(() => {
			setSelected(id);
			selectionTimer.current = null;
		}, 90);
	}
	function select(id: string, source?: HTMLElement) {
		const bounds = source?.getBoundingClientRect();
		const origin = bounds
			? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
			: { x: 120, y: 160 };
		drawer.close(() =>
			chooseFolder(
				id,
				origin,
				folders.find((folder) => folder.id === id)?.color,
			),
		);
	}
	function addFolder() {
		setFolderName("");
		setFolderDescription("");
		setFolderColor("blue");
		setFolderError("");
		setFolderKey("");
		drawer.close(() => folderDialog.open());
	}
	const reloadFolders = useCallback(async () => {
		try {
			const result = await api<{ items: Folder[] }>("/api/project-folders", "GET", undefined, { refresh: true });
			setFolders(result.items); setFolderLoadError("");
		} catch (e) { setFolderLoadError(e instanceof Error ? e.message : "文件夹加载失败，请重试。"); }
	}, []);
	const load = useCallback(async (replace = false, refresh = false) => {
		const run = ++listRun.current;
		listReading.current?.abort();
		const controller = new AbortController(); listReading.current = controller;
		setLoading(true);
		try {
			const [folderId, q, state] = JSON.parse(filterKey) as [string, string, string];
			const params = new URLSearchParams({ q, status: state });
			if (folderId) params.set("folderId", folderId);
			if (!replace && listCursor.current) params.set("cursor", listCursor.current);
			const projectRequest = api<{
				items: ProjectView[];
				nextCursor: string | null;
				counts: { searchMatchCount: number };
			}>(
				`/api/projects?${params}`, "GET", undefined, { signal: controller.signal, refresh },
			);
			const result = await projectRequest;
			if (run !== listRun.current) return;
			setItems((old) =>
				replace
					? result.items
					: [
							...old,
							...result.items.filter(
								(project) =>
									!old.some((existing) => existing.id === project.id),
							),
						],
			);
			setCursor(result.nextCursor);
			setLoadedFilter(filterKey); setMatchCount(result.counts.searchMatchCount);
			setError("");
		} catch (e) {
			if (run === listRun.current && !controller.signal.aborted) setError(e instanceof Error ? e.message : "加载失败");
		} finally {
			if (run === listRun.current) setLoading(false);
		}
	}, [filterKey]);
	useEffect(() => {
		if (initialFilter.current === filterKey) { initialFilter.current = ""; return; }
		const timer = setTimeout(() => void load(true), 250);
		return () => { clearTimeout(timer); listRun.current++; listReading.current?.abort(); };
	}, [filterKey, load]);
	useApiRevalidation(() => { void load(true, true); void reloadFolders(); });
	const sidebarProps = {
		folders,
		selected,
		select,
		add: addFolder,
		query,
		setQuery,
		searchOpen,
		setSearchOpen,
		submitSearch: () => drawer.close(),
	};
	return (
		<div
			ref={shell}
			className="projects-shell"
			style={projectThemeStyle(activeFolder?.color)}
		>
			<div ref={background} className="projects-background" aria-hidden="true">
				<div ref={ripple} className="projects-ripple" hidden />
			</div>
			<aside className="projects-sidebar">
				<FolderSidebar {...sidebarProps} />
			</aside>
			<main className="projects-main">
				<div className="projects-mobile-bar">
					<button
						type="button"
						onClick={() => drawer.open()}
						aria-haspopup="dialog"
					>
						<ProjectIcon kind="menu" />
						文件夹
					</button>
				</div>
				<div ref={content} className="projects-content">
					<header className="projects-heading">
						<h1>
							{searching ? "搜索结果" : (activeFolder?.name ?? "我的项目")}
						</h1>
						<p className="muted" aria-live="polite">
							{activeFolder?.name ?? "全部"}
							{searching ? ` · “${query.trim()}”` : ""} · {projectStatuses[status]} · {loadedFilter === filterKey ? matchCount ?? visible.length : "…"} 个项目{matchCount === null && cursor ? "（已加载）" : ""}
						</p>
						{activeFolder?.description ? (
							<p className="projects-folder-description">
								{activeFolder.description}
							</p>
						) : null}
					</header>
					<div className="projects-status-filter"><label>状态 <select value={status} onChange={event => setStatus(event.target.value as keyof typeof projectStatuses)}>{Object.entries(projectStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
					{refreshing ? <p role="status">读取项目…</p> : null}
					{error ? (
						<p className="error" role="alert">
							{error}{" "}
							<button
								type="button"
								disabled={loading}
								onClick={() => void load(true)}
							>
								{loading ? "加载中…" : "重新加载"}
							</button>
						</p>
					) : null}
					{folderLoadError ? <p className="error" role="alert">{folderLoadError} <button type="button" disabled={loading} onClick={() => void reloadFolders()}>重新加载文件夹</button></p> : null}
					<section aria-label="已有项目" aria-busy={refreshing}>
						{visible.length === 0 && !refreshing ? (
							<p className="empty">
								当前条件下没有项目，可调整状态、文件夹或搜索词。
							</p>
						) : (
							<ul className="project-list projects-list">
								{visible.map((project) => (
									<li key={project.id}>
										<a
											href={projectWorkspaceHref(
												project.id,
												folders.find(
													(folder) => folder.id === project.folderId,
												)?.color,
											)}
										>
											<strong>{project.name}</strong>
											{project.archivedAt ? <span className="project-archive-label">已归档</span> : null}
											<p>{project.description || "暂无项目说明"}</p>
											<small>
												{new Date(project.createdAt).toLocaleDateString(
													"zh-CN",
													{
														timeZone: "Asia/Shanghai",
													},
												)}
											</small>
										</a>
										<div className="project-archive-action"><ArchiveProjectButton project={project} onSaved={() => void load(true)} /></div>
									</li>
								))}
							</ul>
						)}
						{cursor && loadedFilter === filterKey ? (
							<button
								type="button"
								disabled={loading}
								onClick={() => void load()}
							>
								{loading ? "加载中…" : "加载更多项目"}
							</button>
						) : null}
					</section>
				</div>
			</main>
			<button
				type="button"
				className="primary projects-add"
				aria-haspopup="dialog"
				onClick={() => {
					setProjectFolder(selected);
					createDialog.open();
				}}
			>
				<ProjectIcon kind="plus" />
				新增
			</button>
			<dialog
				ref={drawer.ref}
				className="projects-drawer"
				aria-label="文件夹"
				onPointerDown={(event) => drawer.backdrop(event)}
				onCancel={(event) => drawer.cancel(event)}
			>
				<div className="projects-drawer-content">
					<FolderSidebar {...sidebarProps} close={() => drawer.close()} />
				</div>
			</dialog>
			<dialog
				ref={folderDialog.ref}
				className="projects-dialog"
				aria-labelledby="folder-dialog-title"
				onPointerDown={(event) => folderDialog.backdrop(event, folderBusy)}
				onCancel={(event) => folderDialog.cancel(event, folderBusy)}
			>
				<form
					onSubmit={async (e) => {
						e.preventDefault();
						if (folderWrite.current) return;
						const value = folderName.trim();
						if (!value) {
							setFolderError("请填写文件夹名称。");
							return;
						}
						if (
							folders.some(
								(folder) =>
									folder.name.toLocaleLowerCase() === value.toLocaleLowerCase(),
							) ||
							value === "全部"
						) {
							setFolderError("文件夹名称已存在，请换一个名称。");
							return;
						}
						folderWrite.current = true;
						setFolderBusy(true);
						setFolderError("");
						const requestKey = folderKey || crypto.randomUUID();
						setFolderKey(requestKey);
						try {
							const saved = await api<Folder>("/api/project-folders", "POST", {
								name: value, description: folderDescription.trim(), color: folderColor,
							}, { key: requestKey });
							setFolders((old) => [...old.filter((folder) => folder.id !== saved.id), saved]);
							folderDialog.close(() => chooseFolder(saved.id, { x: 120, y: 170 }, saved.color));
						} catch (error) {
							setFolderError(error instanceof Error ? error.message : "文件夹保存失败，请重试。");
						} finally {
							folderWrite.current = false;
							setFolderBusy(false);
						}
					}}
				>
					<header>
						<h2 id="folder-dialog-title">新建文件夹</h2>
						<button
							type="button"
							className="projects-icon-button"
							aria-label="关闭弹窗"
							disabled={folderBusy}
							onClick={() => folderDialog.close()}
						>
							×
						</button>
					</header>
					<fieldset disabled={folderBusy}>
					<label>
						文件夹名称
						<input
							required
							maxLength={60}
							value={folderName}
							onChange={(e) => {
								setFolderName(e.target.value);
								setFolderError("");
								setFolderKey("");
							}}
							placeholder="例如：机械零件"
						/>
					</label>
					<label>
						文件夹说明（可选）
						<textarea
							maxLength={500}
							value={folderDescription}
							onChange={(event) => { setFolderDescription(event.target.value); setFolderKey(""); }}
							placeholder="这个文件夹用于整理哪些项目？"
						/>
					</label>
					<fieldset className="projects-color-field">
						<legend>文件夹颜色</legend>
						<div className="projects-color-options">
							{(Object.keys(folderColors) as FolderColor[]).map((color) => (
								<button
									key={color}
									type="button"
									className="projects-color-option"
									aria-pressed={folderColor === color}
									onClick={() => { setFolderColor(color); setFolderKey(""); }}
								>
									<span
										className="projects-color-dot"
										style={{ backgroundColor: folderColors[color].accent }}
										aria-hidden="true"
									/>
									{folderColors[color].name}
								</button>
							))}
						</div>
					</fieldset>
					</fieldset>
					<p className="muted projects-form-note">
						创建成功后保存到当前账号，刷新或重新登录仍可查看。
					</p>
					{folderError ? (
						<p className="error" role="alert">
							{folderError}
						</p>
					) : null}
					<div className="projects-dialog-actions">
						<button type="button" disabled={folderBusy} onClick={() => folderDialog.close()}>
							取消
						</button>
						<button className="primary" type="submit" disabled={folderBusy}>
							{folderBusy ? "保存中…" : "创建文件夹"}
						</button>
					</div>
				</form>
			</dialog>
			<dialog
				ref={createDialog.ref}
				className="projects-dialog"
				aria-labelledby="project-dialog-title"
				onCancel={(event) => createDialog.cancel(event, busy)}
				onPointerDown={(event) => createDialog.backdrop(event, busy)}
			>
				<form
					onSubmit={async (e) => {
						e.preventDefault();
						if (busy) return;
						if (!name.trim()) {
							setCreateError("请填写项目名称。");
							return;
						}
						setBusy(true);
						setCreateError("");
						const requestKey = key || crypto.randomUUID();
						setKey(requestKey);
						try {
							const project = await api<ProjectView>(
								"/api/projects",
								"POST",
								{ name: name.trim(), description, folderId: projectFolder || null },
								{ key: requestKey },
							);
							createDialog.close(() => {
								setQuery("");
								setStatus("active");
								setMatchCount(null);
								setItems((old) => [
									project,
									...old.filter((item) => item.id !== project.id),
								]);
								chooseFolder(
									projectFolder,
									{ x: window.innerWidth - 80, y: window.innerHeight - 56 },
									folders.find((folder) => folder.id === projectFolder)?.color,
								);
								setName("");
								setDescription("");
								setKey("");
								setBusy(false);
							});
						} catch (err) {
							setCreateError(err instanceof Error ? err.message : "创建失败");
							setBusy(false);
						}
					}}
				>
					<header>
						<h2 id="project-dialog-title">新建项目</h2>
						<button
							type="button"
							className="projects-icon-button"
							disabled={busy}
							aria-label="关闭弹窗"
							onClick={() => createDialog.close()}
						>
							×
						</button>
					</header>
					<fieldset disabled={busy}>
						<label>
							项目名称
							<input
								required
								maxLength={120}
								value={name}
								onChange={(e) => {
									setName(e.target.value);
									setKey("");
								}}
								placeholder="例如：安装板测绘"
							/>
						</label>
						<label>
							项目说明（可选）
							<textarea
								maxLength={4000}
								value={description}
								onChange={(e) => {
									setDescription(e.target.value);
									setKey("");
								}}
								placeholder="可告诉客户需要先上传哪些资料。"
							/>
						</label>
						{folders.length ? (
							<label>
								所属文件夹（可选）
								<select
									value={projectFolder}
									onChange={(e) => { setProjectFolder(e.target.value); setKey(""); }}
								>
									<option value="">暂不分类</option>
									{folders.map((folder) => (
										<option key={folder.id} value={folder.id}>
											{folder.name}
										</option>
									))}
								</select>
							</label>
						) : null}
					</fieldset>
					{createError ? (
						<p className="error" role="alert">
							{createError}
						</p>
					) : null}
					<div className="projects-dialog-actions">
						<button
							type="button"
							disabled={busy}
							onClick={() => createDialog.close()}
						>
							取消
						</button>
						<button type="submit" className="primary" disabled={busy}>
							{busy ? "创建中…" : "创建项目"}
						</button>
					</div>
				</form>
			</dialog>
		</div>
	);
}
