"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type IssueDetail,
	type ResponseInput,
	type Evidence,
	responseSchema,
} from "@/lib/issues";
import { api, ApiError } from "./api";
import { UploadQueue } from "./upload-queue";
import { useIssueWrite } from "./use-issue-write";

export function IssueResponseForm({
	base,
	issue,
	onSaved,
	onInvalid,
	onDirty,
	onReload,
}: {
	base: string;
	issue: IssueDetail;
	onSaved: () => void;
	onInvalid: () => void;
	onDirty: (dirty: boolean) => void;
	onReload: () => void;
}) {
	const [kind, setKind] = useState<ResponseInput["kind"]>(
			issue.kind === "comment" ? "text" : "numeric",
		),
		[value, setValue] = useState(""),
		[unit, setUnit] = useState("mm"),
		[body, setBody] = useState(""),
		[label, setLabel] = useState(""),
		[selected, setSelected] = useState<string[]>([]);
	const [files, setFiles] = useState<Evidence[]>([]),
		[cursor, setCursor] = useState<string | null>(null),
		[fileError, setFileError] = useState(""),
		[filesLoading, setFilesLoading] = useState(false);
	const invalidRef = useRef(onInvalid),
		generation = useRef(0);
	invalidRef.current = onInvalid;
	const loadFiles = useCallback(
		async (next: string | null = null) => {
			const run = ++generation.current;
			setFilesLoading(true);
			try {
				const data = await api<{
					items: Evidence[];
					nextCursor: string | null;
				}>(`${base}/files${next ? `?cursor=${next}` : ""}`);
				if (run !== generation.current) return;
				setFiles((old) => (next ? [...old, ...data.items] : data.items));
				setCursor(data.nextCursor);
				setFileError("");
			} catch (e) {
				if (run !== generation.current) return;
				if (e instanceof ApiError && e.status === 401) invalidRef.current();
				setFileError(e instanceof Error ? e.message : "无法读取附件。");
			} finally {
				if (run === generation.current) setFilesLoading(false);
			}
		},
		[base],
	);
	useEffect(() => {
		void loadFiles();
		return () => {
			generation.current++;
		};
	}, [loadFiles]);
	const refreshFiles = useCallback(() => void loadFiles(), [loadFiles]);
	const write = useIssueWrite(
		`${base}/issues/${issue.id}/responses`,
		issue.revision,
		onSaved,
		onInvalid,
		onDirty,
	);
	const draft = {
		kind,
		...(kind === "numeric" ? { value, unit } : {}),
		body,
		evidenceFileIds: selected,
		guestLabel: label,
	};
	const evidence = (
		<section aria-label="本次回复证据" className="response-evidence">
			<UploadQueue base={base} onReady={refreshFiles} onInvalid={onInvalid} />
			<p>
				上传完成后勾选本次证据；资料上传不等于回复已提交。最多10份，照片回复至少含一张图片。
			</p>
			{filesLoading ? <p role="status">读取可用附件…</p> : null}
			{fileError ? (
				<p role="alert" className="error">
					{fileError}
					<button type="button" onClick={() => void loadFiles()}>
						重试附件列表
					</button>
				</p>
			) : null}
			<div className="evidence-pick-list">
				{files.map((file) => (
					<label key={file.id}>
						<input
							type="checkbox"
							checked={selected.includes(file.id)}
							disabled={!selected.includes(file.id) && selected.length >= 10}
							onChange={(e) => {
								setSelected((old) =>
									e.target.checked
										? [...old, file.id]
										: old.filter((id) => id !== file.id),
								);
								write.changed();
							}}
						/>
						{file.filename} · {file.mime.startsWith("image/") ? "图片" : "附件"}
					</label>
				))}
			</div>
			{selected.length ? <p>已选 {selected.length} 份证据</p> : null}
			{cursor ? (
				<button
					type="button"
					disabled={filesLoading}
					onClick={() => void loadFiles(cursor)}
				>
					更多可用附件
				</button>
			) : null}
		</section>
	);
	return (
		<form
			className="issue-response-form stack"
			aria-label="提交回复"
			onSubmit={(e) => {
				e.preventDefault();
				const parsed = responseSchema.safeParse(draft);
				if (!parsed.success) {
					write.setError(
						kind === "numeric"
							? "请输入正十进制数和单位，不支持负值或科学计数法。"
							: kind === "photo"
								? "请先上传并勾选至少一张处理完成的照片。"
								: "请填写说明并检查附件数量。",
					);
					return;
				}
				void write.submit(parsed.data);
			}}
		>
			<h3>{issue.kind === "comment" ? "回复文件问题" : "提交本次测量"}</h3>
			<fieldset disabled={write.disabled}>
				{issue.kind === "measurement" ? (
					<fieldset className="response-choices" aria-label="选择回复方式">
						{(
							[
								["numeric", "填数值和单位"],
								["photo", "仅上传测量照片"],
								["unable", "无法测量并说明"],
							] as const
						).map(([type, text]) => (
							<button
								type="button"
								key={type}
								aria-pressed={kind === type}
								onClick={() => {
									setKind(type);
									write.changed();
								}}
							>
								{text}
							</button>
						))}
					</fieldset>
				) : null}
				{kind === "numeric" ? (
					<div className="numeric-entry">
						<label>
							测量数值
							<input
								required
								inputMode="decimal"
								value={value}
								maxLength={24}
								onChange={(e) => {
									setValue(e.target.value);
									write.changed();
								}}
							/>
						</label>
						<label>
							测量单位
							<select
								value={unit}
								onChange={(e) => {
									setUnit(e.target.value);
									write.changed();
								}}
							>
								{["mm", "cm", "m", "in"].map((u) => (
									<option key={u}>{u}</option>
								))}
							</select>
						</label>
					</div>
				) : null}
				<label>
					{kind === "unable"
						? "无法测量的原因"
						: kind === "text"
							? "文字回复"
							: "补充说明（可选）"}
					<textarea
						aria-label="回复说明"
						required={kind === "unable" || kind === "text"}
						maxLength={4000}
						value={body}
						onChange={(e) => {
							setBody(e.target.value);
							write.changed();
						}}
					/>
				</label>
				<label>
					你的称呼（可选）
					<input
						maxLength={80}
						value={label}
						onChange={(e) => {
							setLabel(e.target.value);
							write.changed();
						}}
					/>
				</label>
				<p className="muted">称呼仅作显示，不代表已核验身份。</p>
				<details open={kind === "photo"}>
					<summary>添加测量照片或补充附件</summary>
					{evidence}
				</details>
			</fieldset>
			<button type="submit" disabled={write.busy || write.conflict}>
				{write.busy
					? "正在提交回复…"
					: write.blocked
						? "重试提交回复"
						: "提交回复"}
			</button>
			<p role="status">{write.status}</p>
			{write.error ? (
				<p role="alert" className="error">
					{write.error}
				</p>
			) : null}
			{write.blocked ? (
				<div className="save-recovery">
					<p>
						{write.conflict
							? "任务已变化，输入仍保留；请先复制，再重新载入。"
							: "提交结果尚未确认，重试沿用原幂等键，避免重复。"}
					</p>
					<button
						type="button"
						onClick={async () => {
							try {
								await navigator.clipboard.writeText(
									JSON.stringify(draft, null, 2),
								);
								write.setError("草稿已复制，请妥善保存。");
							} catch {
								write.setError("复制未完成，请保留本页。");
							}
						}}
					>
						复制回复草稿
					</button>
					<button
						type="button"
						onClick={() => {
							if (window.confirm("重新载入将放弃本页未提交的输入，继续？"))
								onReload();
						}}
					>
						重新载入任务
					</button>
				</div>
			) : null}
		</form>
	);
}
