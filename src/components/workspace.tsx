"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { Logout, type ProjectView } from "./projects";
import { UploadQueue } from "./upload-queue";
import { AnnotationEditor } from "./annotation-editor";
import { FileIssues } from "./file-issues";
import { IssueInbox } from "./issue-inbox";
import { IssueDetail } from "./issue-detail";
import { DeliverySection } from "./delivery-section";
type Asset = {
	id: string;
	filename: string;
	mime: string;
	extension: string;
	byteSize: number;
	uploaderType: string;
	createdAt: string;
};
function formatBytes(value: number) {
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
	return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}
export function Unavailable() {
	return (
		<main className="page">
			<a className="brand" href="/">
				PartMeasure
			</a>
			<h1>链接已不可用</h1>
			<p>请向工程师索取新链接。项目资料未向当前访问开放。</p>
		</main>
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
		<main className="page">
			<h1>正在打开项目…</h1>
			<p role="status">验证分享权限，请稍候。</p>
		</main>
	);
}
export function Workspace({
	initial,
	guest = false,
}: {
	initial: ProjectView;
	guest?: boolean;
}) {
	const [project, setProject] = useState(initial),
		[section, setSection] = useState("files"),
		[assets, setAssets] = useState<Asset[]>([]),
		[cursor, setCursor] = useState<string | null>(null),
		[selected, setSelected] = useState<Asset | null>(null);
	const [selectedIssue, setSelectedIssue] = useState<string | null>(null),
		[issueRefresh, setIssueRefresh] = useState(0);
	const initialChoiceMade = useRef(false);
	const issueUpdated = useCallback(() => setIssueRefresh((v) => v + 1), []);
	const [error, setError] = useState(""),
		[loading, setLoading] = useState(true),
		[invalid, setInvalid] = useState(false);
	const editorDirty = useRef(false);
	const onEditorDirty = useCallback((dirty: boolean) => {
		editorDirty.current = dirty;
	}, []);
	function allowLeave() {
		return (
			!editorDirty.current ||
			window.confirm(
				"修改尚未确认。离开会丢弃本页草稿，已发出的请求可能仍完成。继续？",
			)
		);
	}
	function selectFile(file: Asset | null) {
		if ((selected?.id !== file?.id || selectedIssue) && !allowLeave()) return;
		initialChoiceMade.current = true;
		setSelectedIssue(null);
		setSelected(file);
	}
	function selectIssue(id: string) {
		if (selectedIssue !== id && !allowLeave()) return;
		initialChoiceMade.current = true;
		setSelected(null);
		setSelectedIssue(id);
	}
	function initialIssue(id: string) {
		if (guest && !initialChoiceMade.current) selectIssue(id);
	}
	function selectSection(next: string) {
		if (next !== section && !allowLeave()) return;
		initialChoiceMade.current = true;
		setSection(next);
	}
	const [shareUrl, setShareUrl] = useState(""),
		[shareMessage, setShareMessage] = useState(""),
		[shareBusy, setShareBusy] = useState(false);
	const [name, setName] = useState(project.name),
		[description, setDescription] = useState(project.description),
		[saving, setSaving] = useState(false);
	const base = `/api/${guest ? "guest/" : ""}projects/${project.id}`;
	const onInvalid = useCallback(() => {
		setInvalid(true);
		setAssets([]);
		setSelected(null);
		setSelectedIssue(null);
		setShareUrl("");
	}, []);
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
	const loadingRequest = useRef(false);
	const load = useCallback(async () => {
		if (loadingRequest.current) return;
		loadingRequest.current = true;
		try {
			const result = await api<{ items: Asset[]; nextCursor: string | null }>(
				`${base}/files`,
			);
			setAssets(result.items);
			setCursor(result.nextCursor);
			setError("");
		} catch (e) {
			failure(e);
		} finally {
			loadingRequest.current = false;
			setLoading(false);
		}
	}, [base, failure]);
	useEffect(() => {
		void load();
		const timer = setInterval(() => {
			if (!document.hidden) void load();
		}, 15000);
		return () => clearInterval(timer);
	}, [load]);
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
			setShareMessage(
				result.url
					? "链接已生成，请立即复制。刷新后不再显示明文。"
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
	if (invalid) return <Unavailable />;
	return (
		<main className="workspace">
			<header className="topbar">
				<a
					className="brand"
					href={guest ? `/s/session?project=${project.id}` : "/projects"}
				>
					PartMeasure
				</a>
				{guest ? (
					<span>客户资料协作</span>
				) : (
					<>
						<a href="/projects">我的项目</a>
						<Logout />
					</>
				)}
			</header>
			<div className="project-heading">
				<div>
					<p className="eyebrow">
						{guest ? "无需注册 · 仅此项目" : "工程师工作台"}
					</p>
					<h1>{project.name}</h1>
					<p>{project.description || "请上传零件照片或现有工程资料。"}</p>
				</div>
				{!guest ? (
					<details className="project-settings">
						<summary>项目说明与分享</summary>
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
										{ revision: project.revision },
									);
									setProject((old) => ({ ...old, ...updated }));
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
									onChange={(e) => setName(e.target.value)}
								/>
							</label>
							<label>
								项目说明
								<textarea
									value={description}
									maxLength={4000}
									onChange={(e) => setDescription(e.target.value)}
								/>
							</label>
							<button type="submit" disabled={saving}>
								{saving ? "保存中…" : "保存项目说明"}
							</button>
						</form>
						<h2>客户分享链接</h2>
						<p className="muted">
							持链接者可查看客户可见资料、上传和下载。有效期 30
							天，可随时撤销。请只发给协作人员。
						</p>
						<div className="actions">
							<button
								type="button"
								disabled={shareBusy}
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
								新分享地址
								<input readOnly value={shareUrl} aria-label="新分享地址" />
								<button
									type="button"
									onClick={async () => {
										try {
											await navigator.clipboard.writeText(shareUrl);
											setShareMessage("已复制。");
										} catch {
											setShareMessage("无法自动复制，请选中地址手动复制。");
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
									? "当前有有效链接；明文不再保留，需要时重新生成。"
									: "尚无有效分享链接。")}
						</p>
					</details>
				) : null}
			</div>
			<nav className="section-nav" aria-label="项目工作区">
				<button
					type="button"
					aria-pressed={section === "files"}
					onClick={() => selectSection("files")}
				>
					资料与补测
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
				<p role="alert" className="error">
					{error}{" "}
					<button type="button" onClick={() => void load()}>
						重试加载
					</button>
				</p>
			) : null}
			{section === "deliveries" ? (
				<DeliverySection base={base} guest={guest} onInvalid={onInvalid} onDirty={onEditorDirty}/>
			) : (
				<>
					<IssueInbox
						base={base}
						guest={guest}
						refreshKey={issueRefresh}
						onSelect={selectIssue}
						onInitial={initialIssue}
						onInvalid={onInvalid}
						onBrowse={() => selectFile(null)}
					/>
					<div
						className={`file-workspace ${guest ? "guest-layout" : ""} ${selected || selectedIssue ? "file-focused" : ""}`}
					>
						<aside className="file-column">
							<UploadQueue
								base={base}
								onReady={() => void load()}
								onInvalid={onInvalid}
							/>
							<h2>项目资料</h2>
							{loading ? (
								<p role="status">加载资料…</p>
							) : assets.length === 0 ? (
								<p className="empty">
									还没有可查看资料。请先上传照片、PDF 或
									CAD；处理中的文件会保留在上传队列。
								</p>
							) : null}
							<ul className="file-list">
								{assets.map((file) => (
									<li key={file.id}>
										<button
											type="button"
											className={selected?.id === file.id ? "selected" : ""}
											onClick={() => selectFile(file)}
										>
											<strong>{file.filename}</strong>
											<small>
												{file.extension.toUpperCase()} ·{" "}
												{formatBytes(Number(file.byteSize))}
											</small>
											<small>
												{file.uploaderType === "owner" ? "工程师" : "客户"} ·{" "}
												{new Date(file.createdAt).toLocaleString("zh-CN", {
													timeZone: "Asia/Shanghai",
												})}
											</small>
										</button>
									</li>
								))}
							</ul>
							{cursor ? (
								<button
									type="button"
									onClick={async () => {
										try {
											const next = await api<{
												items: Asset[];
												nextCursor: string | null;
											}>(`${base}/files?cursor=${cursor}`);
											setAssets((old) => [...old, ...next.items]);
											setCursor(next.nextCursor);
										} catch (e) {
											failure(e);
										}
									}}
								>
									加载更多资料
								</button>
							) : null}
						</aside>
						<section
							className={`file-detail ${selected || selectedIssue ? "has-file" : ""}`}
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
								/>
							) : null}
							{selected ? (
								<button
									className="back-to-files"
									type="button"
									onClick={() => selectFile(null)}
								>
									返回资料列表
								</button>
							) : null}
							{selected ? (
								<>
									<div className="detail-heading">
										<h2>{selected.filename}</h2>
										<div className="actions">
											<a
												className="button"
												href={`${base}/files/${selected.id}/download`}
											>
												下载
												{selected.mime.startsWith("image/") ? "标准图" : "附件"}
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
									</div>
									{selected.mime.startsWith("image/") ? (
										<AnnotationEditor
											key={selected.id}
											base={base}
											fileId={selected.id}
											guest={guest}
											onInvalid={onInvalid}
											onDirty={onEditorDirty}
											onIssueCreated={issueUpdated}
										/>
									) : (
										<>
											<div className="empty">
												<p>{selected.extension.toUpperCase()} 附件</p>
												<p>此格式暂不提供在线预览，请下载后用对应软件打开。</p>
											</div>
											<FileIssues
												key={selected.id}
												base={base}
												fileId={selected.id}
												guest={guest}
												onInvalid={onInvalid}
												onOpen={selectIssue}
												onCreated={issueUpdated}
											/>
										</>
									)}
								</>
							) : !selectedIssue ? (
								<div className="empty">
									<h2>{assets.length ? "选择一份资料" : "从零件资料开始"}</h2>
									<p>
										{guest
											? "请上传零件正反面照片，也可补充 CAD、PDF。"
											: "可以先上传已有资料，或生成分享链接让客户先上传。"}
									</p>
								</div>
							) : null}
						</section>
						{!guest && !selected && !selectedIssue ? (
							<aside className="stage-note">
								<h2>补测</h2>
								<p>选择图片添加标注；选择附件填写文件问题。</p>
								<p className="muted">可以先上传已有资料，并与客户共享。</p>
							</aside>
						) : null}
					</div>
				</>
			)}
		</main>
	);
}
