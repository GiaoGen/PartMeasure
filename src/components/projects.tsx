"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, onApiSessionCleared } from "./api";
import { projectStatuses } from "@/lib/archive-filters";
import { ArchiveProjectButton } from "./archive-project-button";
import { useApiRevalidation } from "./use-api-revalidation";
import type { FolderSummary } from "@/lib/project-folders";
import { useProjectDialog } from "./projects-motion";
import { ProductSurface, AppearanceControl } from "./product-surface";
import { ProductBrand } from "./product-brand";
import {
	defaultProjectList,
	projectListHref,
	rememberProjectListScroll,
	type ProjectListState,
} from "./project-list-navigation";
import { useProjectListNavigation } from "./use-project-list-navigation";
import {
	folderColors,
	projectWorkspaceHref,
	type Folder,
	type FolderColor,
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
}: {
	folders: Folder[];
	selected: string;
	select: (id: string) => void;
	add: () => void;
	close?: () => void;
}) {
	return (
		<>
			<div className="projects-sidebar-heading">
				<ProductBrand href="/projects" />
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
				<p className="projects-nav-label">项目空间</p>
				<button
					type="button"
					className="projects-folder"
					aria-pressed={selected === ""}
					onClick={() => select("")}
				>
					<ProjectIcon kind="all" />
					<span>全部项目</span>
				</button>
				<div className="projects-folder-heading">
					<span>文件夹</span>
					<button
						type="button"
						className="projects-icon-button"
						onClick={add}
						aria-label="新建文件夹"
					>
						<ProjectIcon kind="plus" />
					</button>
				</div>
				{folders.map((folder) => (
					<button
						type="button"
						key={folder.id}
						className="projects-folder"
						aria-pressed={selected === folder.id}
						onClick={() => select(folder.id)}
					>
						<span
							className="projects-folder-dot"
							style={{ backgroundColor: folderColors[folder.color].accent }}
							aria-hidden="true"
						/>
						<span>{folder.name}</span>
					</button>
				))}
				{!folders.length ? (
					<p className="projects-folder-empty">按客户或零件类型创建文件夹。</p>
				) : null}
			</nav>
			<footer className="projects-sidebar-footer">
				<AppearanceControl />
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
	initialFilters = defaultProjectList,
	initialCount = null,
}: {
	initial: ProjectView[];
	initialCursor: string | null;
	initialError: string;
	initialFolders: Folder[];
	initialFolderError: string;
	initialFilters?: ProjectListState;
	initialCount?: number | null;
}) {
	const { filters, query, setQuery, change, restoreScroll } =
		useProjectListNavigation(initialFilters);
	const selected = filters.folderId;
	const status = filters.status;
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
		[projectFolder, setProjectFolder] = useState("");
	const [folderBusy, setFolderBusy] = useState(false);
	const [folderLoadError, setFolderLoadError] = useState(initialFolderError);
	const folderWrite = useRef(false);
	const projectWrite = useRef(false);
	const [folderKey, setFolderKey] = useState("");
	const [folderName, setFolderName] = useState(""),
		[folderError, setFolderError] = useState("");
	const [folderDescription, setFolderDescription] = useState("");
	const [folderColor, setFolderColor] = useState<FolderColor>("blue");
	const [matchCount, setMatchCount] = useState<number | null>(initialCount);
	const [sessionExpired, setSessionExpired] = useState(false);
	const expired = useRef(false);
	const listRun = useRef(0);
	const listReading = useRef<AbortController | null>(null);
	const listCursor = useRef(cursor);
	listCursor.current = cursor;
	const filterKey = JSON.stringify([selected, filters.q, status]);
	const initialFilter = useRef(filterKey);
	const [loadedFilter, setLoadedFilter] = useState(filterKey);
	const createDialog = useProjectDialog(),
		folderDialog = useProjectDialog(),
		drawer = useProjectDialog();
	const shell = useRef<HTMLDivElement>(null);
	const activeFolder = folders.find((folder) => folder.id === selected);
	const visible = loadedFilter === filterKey ? items : [];
	const refreshing = loading || (loadedFilter !== filterKey && !error);
	const searching = filters.q.length > 0;
	const resultDescription = refreshing
		? "正在读取项目…"
		: error
			? "项目暂未加载完成"
			: `${searching ? `搜索“${filters.q}” · ` : ""}${projectStatuses[status]} · ${matchCount ?? visible.length} 个项目${matchCount === null && cursor ? "（已加载）" : ""}`;
	useEffect(() => {
		const viewport = window.visualViewport;
		const resize = () => {
			shell.current?.style.setProperty(
				"--projects-viewport-height",
				`${viewport?.height ?? window.innerHeight}px`,
			);
			shell.current?.style.setProperty(
				"--projects-viewport-top",
				`${viewport?.offsetTop ?? 0}px`,
			);
		};
		resize();
		viewport?.addEventListener("resize", resize);
		viewport?.addEventListener("scroll", resize);
		return () => {
			viewport?.removeEventListener("resize", resize);
			viewport?.removeEventListener("scroll", resize);
		};
	}, []);
	useEffect(() => {
		if (!refreshing && !error) return restoreScroll(filters);
	}, [refreshing, error, restoreScroll, filters]);
	function chooseFolder(id: string) {
		if (!expired.current) change({ ...filters, folderId: id, q: query.trim() });
	}
	function select(id: string) {
		drawer.close(() => chooseFolder(id));
	}
	function addFolder() {
		if (expired.current) return;
		setFolderName("");
		setFolderDescription("");
		setFolderColor("blue");
		setFolderError("");
		setFolderKey("");
		drawer.close(() => folderDialog.open());
	}
	const reloadFolders = useCallback(async () => {
		if (expired.current) return;
		try {
			const result = await api<{ items: Folder[] }>(
				"/api/project-folders",
				"GET",
				undefined,
				{ refresh: true },
			);
			setFolders(result.items);
			setFolderLoadError("");
		} catch (e) {
			setFolderLoadError(
				e instanceof Error ? e.message : "文件夹加载失败，请重试。",
			);
		}
	}, []);
	const load = useCallback(
		async (replace = false, refresh = false) => {
			if (expired.current) return;
			const run = ++listRun.current;
			listReading.current?.abort();
			const controller = new AbortController();
			listReading.current = controller;
			setLoading(true);
			setError("");
			try {
				const [folderId, q, state] = JSON.parse(filterKey) as [
					string,
					string,
					string,
				];
				const params = new URLSearchParams({ q, status: state });
				if (folderId) params.set("folderId", folderId);
				if (!replace && listCursor.current)
					params.set("cursor", listCursor.current);
				const projectRequest = api<{
					items: ProjectView[];
					nextCursor: string | null;
					counts: { searchMatchCount: number };
				}>(`/api/projects?${params}`, "GET", undefined, {
					signal: controller.signal,
					refresh,
				});
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
				setLoadedFilter(filterKey);
				setMatchCount(result.counts.searchMatchCount);
				setError("");
			} catch (e) {
				if (run === listRun.current && !controller.signal.aborted)
					setError(e instanceof Error ? e.message : "加载失败");
			} finally {
				if (run === listRun.current) setLoading(false);
			}
		},
		[filterKey],
	);
	useEffect(() => {
		if (initialFilter.current === filterKey) {
			initialFilter.current = "";
			return;
		}
		void load(true);
		return () => {
			listRun.current++;
			listReading.current?.abort();
		};
	}, [filterKey, load]);
	useEffect(
		() => () => {
			listRun.current++;
			listReading.current?.abort();
		},
		[],
	);
	useEffect(
		() =>
			onApiSessionCleared((reason) => {
				if (reason !== "identity") return;
				expired.current = true;
				setSessionExpired(true);
				listRun.current++;
				listReading.current?.abort();
				setItems([]);
				setFolders([]);
				setCursor(null);
				setMatchCount(null);
				setLoading(false);
				setName("");
				setDescription("");
				setFolderName("");
				setFolderDescription("");
				setKey("");
				setFolderKey("");
				setFolderLoadError("");
				setError("登录状态已变化，请重新登录。");
				createDialog.ref.current?.close();
				folderDialog.ref.current?.close();
				drawer.ref.current?.close();
			}),
		[createDialog.ref, folderDialog.ref, drawer.ref],
	);
	useApiRevalidation(() => {
		void load(true, true);
		void reloadFolders();
	});
	const sidebarProps = { folders, selected, select, add: addFolder };
	return (
		<ProductSurface className="pm-projects">
			<div ref={shell} className="projects-shell">
				<a className="pm-skip" href="#projects-main">
					跳到项目列表
				</a>
				<aside className="projects-sidebar">
					<FolderSidebar {...sidebarProps} />
				</aside>
				<main className="projects-main" id="projects-main" tabIndex={-1}>
					<header className="projects-heading">
						<div>
							<div className="projects-mobile-bar">
								<button
									type="button"
									onClick={() => drawer.open()}
									aria-haspopup="dialog"
								>
									<ProjectIcon kind="menu" />
									文件夹
								</button>
								<AppearanceControl />
							</div>
							<h1>
								{activeFolder?.name ??
									(selected === "none" ? "未分类项目" : "我的项目")}
							</h1>
							<p className="muted">
								{activeFolder?.description ||
									"整理资料、定位补测，按版本交接成果。"}
							</p>
						</div>
						<button
							type="button"
							className="primary projects-create-button"
							disabled={sessionExpired}
							aria-haspopup="dialog"
							onClick={() => {
								setProjectFolder(selected === "none" ? "" : selected);
								createDialog.open();
							}}
						>
							<ProjectIcon kind="plus" />
							新建项目
						</button>
					</header>
					<div className="projects-toolbar">
						<search className="projects-search" aria-label="项目搜索">
							<form
								onSubmit={(event) => {
									event.preventDefault();
									change({ ...filters, q: query.trim() });
								}}
							>
								<label className="projects-search-field">
									<span className="pm-sr-only">搜索项目名称或说明</span>
									<ProjectIcon kind="search" />
									<input
										type="search"
										name="q"
										maxLength={200}
										value={query}
										onChange={(event) => setQuery(event.target.value)}
										placeholder="搜索项目名称或说明"
										enterKeyHint="search"
										autoComplete="off"
									/>
								</label>
							</form>
						</search>
						<fieldset className="projects-status-filter">
							<legend className="pm-sr-only">项目状态</legend>
							{(
								Object.keys(projectStatuses) as Array<
									keyof typeof projectStatuses
								>
							).map((value) => (
								<button
									type="button"
									key={value}
									aria-pressed={status === value}
									onClick={() =>
										change({ ...filters, status: value, q: query.trim() })
									}
								>
									{projectStatuses[value]}
								</button>
							))}
						</fieldset>
					</div>
					<p className="projects-result-count" role="status">
						{resultDescription}
					</p>
					{error ? (
						<div className="pm-notice error" role="alert">
							{error}
							{sessionExpired ? (
								<Link href="/login" prefetch={false}>
									重新登录
								</Link>
							) : (
								<button
									type="button"
									disabled={loading}
									onClick={() => void load(true, true)}
								>
									重新加载
								</button>
							)}
						</div>
					) : null}
					{folderLoadError ? (
						<div className="pm-notice error" role="alert">
							{folderLoadError}
							<button type="button" onClick={() => void reloadFolders()}>
								重新加载文件夹
							</button>
						</div>
					) : null}
					<section aria-label="已有项目" aria-busy={refreshing}>
						{!refreshing && !error && !visible.length ? (
							<div className="projects-empty">
								<ProjectIcon kind="folder" />
								<h2>
									{searching || selected || status !== "active"
										? "没有符合条件的项目"
										: "开始你的第一个项目"}
								</h2>
								<p>
									{searching || selected || status !== "active"
										? "试试其他搜索词、文件夹或项目状态。"
										: "新建项目，上传零件资料，或分享给客户补充。"}
								</p>
								{searching || selected || status !== "active" ? (
									<button
										type="button"
										onClick={() => change({ ...defaultProjectList })}
									>
										清除筛选
									</button>
								) : (
									<button
										type="button"
										className="primary"
										onClick={() => createDialog.open()}
									>
										新建项目
									</button>
								)}
							</div>
						) : null}
						{visible.length ? (
							<>
								<div className="projects-table-head" aria-hidden="true">
									<span>项目名称</span>
									<span>文件夹</span>
									<span>创建日期</span>
									<span>操作</span>
								</div>
								<ul className="project-list projects-list">
									{visible.map((project) => {
										const folder =
											folders.find((item) => item.id === project.folderId) ??
											project.folder;
										return (
											<li key={project.id}>
												<Link
													className="project-link"
													prefetch={false}
													href={projectWorkspaceHref(project.id, folder?.color, projectListHref(filters))}
													onClick={rememberProjectListScroll}
												>
													<span className="project-row-icon">
														<ProjectIcon kind="folder" />
													</span>
													<span className="project-row-text">
														<span className="project-row-title">
															<strong>{project.name}</strong>
															{project.archivedAt ? (
																<span className="project-archive-label">
																	已归档
																</span>
															) : null}
														</span>
														{project.description ? (
															<span className="project-row-description">
																{project.description}
															</span>
														) : null}
													</span>
													<span className="project-row-folder">
														{folder ? (
															<>
																<span
																	className="projects-folder-dot"
																	style={{
																		backgroundColor:
																			folderColors[folder.color].accent,
																	}}
																	aria-hidden="true"
																/>
																{folder.name}
															</>
														) : (
															"未分类"
														)}
													</span>
													<time dateTime={project.createdAt}>
														{new Date(project.createdAt).toLocaleDateString(
															"zh-CN",
															{ timeZone: "Asia/Shanghai" },
														)}
													</time>
												</Link>
												<div className="project-archive-action">
													<ArchiveProjectButton
														project={project}
														onSaved={() => void load(true)}
													/>
												</div>
											</li>
										);
									})}
								</ul>
							</>
						) : null}
						{cursor && loadedFilter === filterKey ? (
							<div className="projects-pagination">
								<button
									type="button"
									disabled={loading}
									onClick={() => void load()}
								>
									{loading ? "加载中…" : "加载更多项目"}
								</button>
							</div>
						) : null}
					</section>
				</main>
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
										folder.name.toLocaleLowerCase() ===
										value.toLocaleLowerCase(),
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
								const saved = await api<Folder>(
									"/api/project-folders",
									"POST",
									{
										name: value,
										description: folderDescription.trim(),
										color: folderColor,
									},
									{ key: requestKey },
								);
								setFolders((old) => [
									...old.filter((folder) => folder.id !== saved.id),
									saved,
								]);
								folderDialog.close(() => chooseFolder(saved.id));
							} catch (error) {
								setFolderError(
									error instanceof Error
										? error.message
										: "文件夹保存失败，请重试。",
								);
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
									onChange={(event) => {
										setFolderDescription(event.target.value);
										setFolderKey("");
									}}
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
											onClick={() => {
												setFolderColor(color);
												setFolderKey("");
											}}
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
							<button
								type="button"
								disabled={folderBusy}
								onClick={() => folderDialog.close()}
							>
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
							if (projectWrite.current || expired.current) return;
							if (!name.trim()) {
								setCreateError("请填写项目名称。");
								return;
							}
							projectWrite.current = true;
							setBusy(true);
							setCreateError("");
							const requestKey = key || crypto.randomUUID();
							setKey(requestKey);
							try {
								const project = await api<ProjectView>(
									"/api/projects",
									"POST",
									{
										name: name.trim(),
										description,
										folderId: projectFolder || null,
									},
									{ key: requestKey },
								);
								createDialog.close(() => {
									if (expired.current) return;
									setMatchCount(null);
									setItems((old) => [
										project,
										...old.filter((item) => item.id !== project.id),
									]);
									change({ folderId: projectFolder, q: "", status: "active" });
									setName("");
									setDescription("");
									setKey("");
									setBusy(false);
									projectWrite.current = false;
								});
							} catch (err) {
								projectWrite.current = false;
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
										onChange={(e) => {
											setProjectFolder(e.target.value);
											setKey("");
										}}
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
		</ProductSurface>
	);
}
