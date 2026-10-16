"use client";
import { useEffect, useRef, useState } from "react";
import type { FileIssue } from "@/lib/annotations";
import { api, ApiError } from "./api";
export function FileIssues({
	base,
	fileId,
	guest,
	onInvalid,
}: {
	base: string;
	fileId: string;
	guest: boolean;
	onInvalid: () => void;
}) {
	const [items, setItems] = useState<FileIssue[]>([]),
		[loading, setLoading] = useState(true),
		[error, setError] = useState(""),
		[title, setTitle] = useState(""),
		[description, setDescription] = useState(""),
		[busy, setBusy] = useState(false),
		[status, setStatus] = useState(""),
		[cursor, setCursor] = useState<string | null>(null);
	const key = useRef(crypto.randomUUID()),
		invalidRef = useRef(onInvalid);
	invalidRef.current = onInvalid;
	async function load(next: string | null = null) {
		setLoading(true);
		setError("");
		try {
			const data = await api<{ items: FileIssue[]; nextCursor: string | null }>(
				`${base}/files/${fileId}/issues${next ? `?cursor=${next}` : ""}`,
			);
			setItems((old) => (next ? [...old, ...data.items] : data.items));
			setCursor(data.nextCursor);
		} catch (e) {
			if (e instanceof ApiError && e.status === 401) invalidRef.current();
			setError(e instanceof Error ? e.message : "读取问题失败。");
		} finally {
			setLoading(false);
		}
	}
	// A new file remounts this component; no polling or state shared across files.
	// biome-ignore lint/correctness/useExhaustiveDependencies: component keyed by immutable fileId/base in workspace.
	useEffect(() => {
		void load();
	}, []);
	return (
		<section className="file-issues" aria-label="文件级文字问题">
			<h3>文件问题</h3>
			<p className="muted">
				针对这份文件的文字说明，不关联几何位置。测量回复与审核尚未开放。
			</p>
			{loading ? (
				<p role="status">读取文件问题…</p>
			) : !items.length ? (
				<p>尚无文件问题。</p>
			) : null}
			{error ? (
				<p role="alert" className="error">
					{error}{" "}
					<button type="button" onClick={() => void load()}>
						重试读取问题
					</button>
				</p>
			) : null}
			<ul className="issue-list">
				{items.map((item) => (
					<li key={item.id}>
						<strong>{item.title}</strong>
						<p>{item.description}</p>
						<small>
							{new Date(item.createdAt).toLocaleString("zh-CN")} · 工程师
						</small>
					</li>
				))}
			</ul>
			{cursor ? (
				<button
					type="button"
					disabled={loading}
					onClick={() => void load(cursor)}
				>
					更早的文件问题
				</button>
			) : null}
			{!guest ? (
				<form
					className="stack"
					onSubmit={async (e) => {
						e.preventDefault();
						if (busy) return;
						setBusy(true);
						setError("");
						try {
							const result = await api<FileIssue>(
								`${base}/issues`,
								"POST",
								{ fileId, title, description },
								{ key: key.current },
							);
							setItems((old) => [
								result,
								...old.filter((i) => i.id !== result.id),
							]);
							setTitle("");
							setDescription("");
							key.current = crypto.randomUUID();
							setStatus("文件问题已保存");
						} catch (e) {
							if (e instanceof ApiError && e.status === 401)
								invalidRef.current();
							setError(e instanceof Error ? e.message : "创建失败，请重试。");
						} finally {
							setBusy(false);
						}
					}}
				>
					<label>
						问题标题
						<input
							required
							maxLength={120}
							disabled={busy}
							value={title}
							onChange={(e) => {
								setTitle(e.target.value);
								key.current = crypto.randomUUID();
							}}
						/>
					</label>
					<label>
						问题说明
						<textarea
							aria-label="问题说明"
							maxLength={4000}
							disabled={busy}
							value={description}
							onChange={(e) => {
								setDescription(e.target.value);
								key.current = crypto.randomUUID();
							}}
						/>
					</label>
					<button disabled={busy} type="submit">
						{busy ? "正在保存问题…" : "保存文件问题"}
					</button>
					<p role="status">{status}</p>
				</form>
			) : null}
		</section>
	);
}
