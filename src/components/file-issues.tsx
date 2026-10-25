"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type IssueSummary, stateLabel } from "@/lib/issues";
import { useIssueWrite } from "./use-issue-write";
import { api, ApiError } from "./api";
export function FileIssues({
	base,
	fileId,
	guest,
	onInvalid,
	onOpen,
	onCreated,
	refreshKey = 0,
	onDirty,
}: {
	base: string;
	fileId: string;
	guest: boolean;
	onInvalid: () => void;
	onOpen: (id: string) => void;
	onCreated: () => void;
	refreshKey?: number;
	onDirty?: (dirty: boolean) => void;
}) {
	const [items, setItems] = useState<IssueSummary[]>([]),
		[loading, setLoading] = useState(true),
		[error, setError] = useState(""),
		[title, setTitle] = useState(""),
		[description, setDescription] = useState(""),
		[cursor, setCursor] = useState<string | null>(null);
	const invalidRef = useRef(onInvalid),
		generation = useRef(0);
	invalidRef.current = onInvalid;
	const write = useIssueWrite<IssueSummary>(
		`${base}/issues`,
		undefined,
		(result) => {
			setItems((old) => [
				result,
				...old.filter((item) => item.id !== result.id),
			]);
			setTitle("");
			setDescription("");
			onCreated();
		},
		onInvalid,
		onDirty,
	);
	const load = useCallback(
		async (next: string | null = null) => {
			const run = ++generation.current;
			setLoading(true);
			setError("");
			try {
				const data = await api<{
					items: IssueSummary[];
					nextCursor: string | null;
				}>(
					`${base}/files/${fileId}/issues${next ? `?cursor=${encodeURIComponent(next)}` : ""}`,
				);
				if (run !== generation.current) return;
				setItems((old) => (next ? [...old, ...data.items] : data.items));
				setCursor(data.nextCursor);
			} catch (e) {
				if (run !== generation.current) return;
				if (e instanceof ApiError && e.status === 401) invalidRef.current();
				setError(e instanceof Error ? e.message : "读取问题失败。");
			} finally {
				if (run === generation.current) setLoading(false);
			}
		},
		[base, fileId],
	);
	useEffect(() => {
		void refreshKey;
		void load();
		return () => {
			generation.current++;
		};
	}, [load, refreshKey]);
	return (
		<section className="file-issues" aria-label="文件级文字问题">
			<h3>测量提醒与文件问题</h3>
			{loading ? (
				<p role="status">读取文件问题…</p>
			) : !items.length ? (
				<p>暂无提醒</p>
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
						<p>
							{stateLabel[item.state]}{" "}
							<button type="button" onClick={() => onOpen(item.id)}>
								查看与回复
							</button>
						</p>
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
				<details>
					<summary>添加文件说明</summary>
					<form
						className="stack"
						onSubmit={(e) => {
							e.preventDefault();
							void write.submit({ fileId, title, description });
						}}
					>
						<label>
							问题标题
							<input
								required
								maxLength={120}
								disabled={write.disabled}
								value={title}
								onChange={(e) => {
									setTitle(e.target.value);
									write.changed();
								}}
							/>
						</label>
						<label>
							问题说明
							<textarea
								aria-label="问题说明"
								maxLength={4000}
								disabled={write.disabled}
								value={description}
								onChange={(e) => {
									setDescription(e.target.value);
									write.changed();
								}}
							/>
						</label>
						<button disabled={write.busy || write.conflict || write.readOnly} type="submit">
							{write.busy
								? "保存中…"
								: write.blocked
									? "重试保存"
									: "保存文件说明"}
						</button>
						<p role="status">{write.status}</p>
						{write.error ? (
							<p role="alert" className="error">
								{write.error}
							</p>
						) : null}
					</form>
				</details>
			) : null}
		</section>
	);
}
