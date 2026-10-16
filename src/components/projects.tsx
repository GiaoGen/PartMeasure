"use client";
import { useState } from "react";
import { api } from "./api";
export type ProjectView = {
	id: string;
	name: string;
	description: string;
	revision: number;
	createdAt: string;
	share?: { id: string; expiresAt: string; revokedAt: string | null } | null;
};
export function Logout() {
	const [error, setError] = useState("");
	return (
		<>
			<button
				type="button"
				onClick={async () => {
					try {
						await api("/api/auth/logout", "POST");
						window.location.assign("/login");
					} catch {
						setError("退出未完成，请重试。");
					}
				}}
			>
				退出登录
			</button>
			{error ? <span role="alert">{error}</span> : null}
		</>
	);
}
export function Projects({
	initial,
	initialCursor,
	initialError,
}: {
	initial: ProjectView[];
	initialCursor: string | null;
	initialError: string;
}) {
	const [items, setItems] = useState(initial),
		[cursor, setCursor] = useState(initialCursor),
		[error, setError] = useState(initialError),
		[busy, setBusy] = useState(false);
	const [name, setName] = useState(""),
		[description, setDescription] = useState(""),
		[key, setKey] = useState("");
	async function load(replace = false) {
		try {
			const result = await api<{
				items: ProjectView[];
				nextCursor: string | null;
			}>(`/api/projects${!replace && cursor ? `?cursor=${cursor}` : ""}`);
			setItems((old) => (replace ? result.items : [...old, ...result.items]));
			setCursor(result.nextCursor);
			setError("");
		} catch (e) {
			setError(e instanceof Error ? e.message : "加载失败");
		}
	}
	return (
		<main className="page">
			<header className="topbar">
				<a className="brand" href="/projects">
					PartMeasure
				</a>
				<Logout />
			</header>
			<h1>我的项目</h1>
			<p className="muted">从资料开始，逐步确认零件信息。</p>
			<form
				className="project-create"
				onSubmit={async (e) => {
					e.preventDefault();
					setBusy(true);
					setError("");
					const requestKey = key || crypto.randomUUID();
					setKey(requestKey);
					try {
						const p = await api<ProjectView>(
							"/api/projects",
							"POST",
							{ name, description },
							{ key: requestKey },
						);
						window.location.assign(`/projects/${p.id}`);
					} catch (err) {
						setError(err instanceof Error ? err.message : "创建失败");
					} finally {
						setBusy(false);
					}
				}}
			>
				<h2>新建项目</h2>
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
				<button type="submit" className="primary" disabled={busy}>
					{busy ? "创建中…" : "创建项目"}
				</button>
			</form>
			{error ? (
				<p className="error" role="alert">
					{error}{" "}
					<button type="button" onClick={() => void load(true)}>
						重新加载
					</button>
				</p>
			) : null}
			<section aria-label="已有项目">
				{items.length === 0 ? (
					<p className="empty">
						还没有项目。填写名称后即可开始，也可以创建后分享给客户先上传。
					</p>
				) : (
					<ul className="project-list">
						{items.map((p) => (
							<li key={p.id}>
								<a href={`/projects/${p.id}`}>
									<strong>{p.name}</strong>
									<p>{p.description || "暂无项目说明"}</p>
									<small>
										{new Date(p.createdAt).toLocaleDateString("zh-CN", {
											timeZone: "Asia/Shanghai",
										})}
									</small>
								</a>
							</li>
						))}
					</ul>
				)}
				{cursor ? (
					<button type="button" onClick={() => void load()}>
						加载更多项目
					</button>
				) : null}
			</section>
		</main>
	);
}
