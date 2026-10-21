"use client";
import {
	unitsForField,
	displayUnit,
	measurementFieldLabel,
} from "@/lib/annotation-collaboration";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import {
	type IssueDetail,
	type IssueWriteResult,
	type ResponseInput,
	type Evidence,
	responseSchema,
} from "@/lib/issues";
import { api, ApiError } from "./api";
import { UploadQueue, type ReadyUpload } from "./upload-queue";
import { useIssueWrite } from "./use-issue-write";

export function IssueResponseForm({
	base,
	issue,
	onSaved,
	onInvalid,
	onDirty,
	onReload,
	compact = false,
	extraContent,
}: {
	base: string;
	issue: IssueDetail;
	onSaved: (result: IssueWriteResult) => void;
	onInvalid: () => void;
	onDirty: (dirty: boolean) => void;
	onReload: () => void;
	compact?: boolean;
	extraContent?: ReactNode;
}) {
	const [kind, setKind] = useState<ResponseInput["kind"]>(
			issue.kind === "comment" ? "text" : "numeric",
		),
		[value, setValue] = useState(""),
		[unit, setUnit] = useState<string>(
			issue.measurementField === "angleValue"
				? "deg"
				: (issue.target?.annotation.metadata.unit ?? "mm"),
		),
		[body, setBody] = useState(""),
		[label, setLabel] = useState(""),
		[selected, setSelected] = useState<string[]>([]);
	const [files, setFiles] = useState<Evidence[]>([]),
		[cursor, setCursor] = useState<string | null>(null),
		[fileError, setFileError] = useState(""),
		[filesLoading, setFilesLoading] = useState(false);
	const [extrasOpen, setExtrasOpen] = useState(false),
		[evidenceOpen, setEvidenceOpen] = useState(false),
		[evidenceMounted, setEvidenceMounted] = useState(false);
	const uploaded = useRef(new Set<string>());
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
				}>(`${base}/files${next ? `?cursor=${next}` : ""}`, "GET", undefined, {
					cacheMs: 1000,
				});
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
		if (!compact) void loadFiles();
		return () => {
			generation.current++;
		};
	}, [loadFiles, compact]);

	const write = useIssueWrite<IssueWriteResult>(
		`${base}/issues/${issue.id}/responses`,
		issue.revision,
		onSaved,
		onInvalid,
		onDirty,
	);
	const refreshFiles = useCallback(
		(file?: ReadyUpload) => {
			if (!compact) {
				void loadFiles();
				return;
			}
			if (!file || uploaded.current.has(file.id)) return;
			uploaded.current.add(file.id);
			setFiles((old) =>
				old.some((f) => f.id === file.id) ? old : [...old, file],
			);
			setSelected((old) =>
				old.includes(file.id) || old.length >= 10 ? old : [...old, file.id],
			);
			write.changed();
		},
		[compact, loadFiles, write.changed],
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
			<UploadQueue
				base={base}
				onReady={refreshFiles}
				onInvalid={onInvalid}
				localOnly={compact}
			/>
			<p>
				{compact
					? "上传完成后自动加入本次回复，最多10份；提交后工程师才能收到回复。"
					: "上传完成后勾选本次证据；资料上传不等于回复已提交。最多10份，照片回复至少含一张图片。"}
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
	const extras = (
		<>
			<details
				open={evidenceOpen || kind === "photo"}
				onToggle={(e) => {
					setEvidenceOpen(e.currentTarget.open);
					if (e.currentTarget.open) setEvidenceMounted(true);
				}}
			>
				<summary>照片与附件</summary>
				{!compact || evidenceMounted || evidenceOpen || kind === "photo"
					? evidence
					: null}
			</details>
			{kind !== "text" ? (
				<label>
					{kind === "unable" ? "无法测量的原因" : "补充说明（选填）"}
					<textarea
						aria-label="回复说明"
						required={kind === "unable"}
						maxLength={4000}
						value={body}
						onChange={(e) => {
							setBody(e.target.value);
							write.changed();
						}}
					/>
				</label>
			) : null}
			{issue.kind === "measurement" ? (
				<fieldset className="response-choices" aria-label="其他回复方式">
					{(
						[
							["photo", "仅传照片"],
							["unable", "无法测量"],
						] as const
					).map(([type, text]) => (
						<button
							type="button"
							key={type}
							aria-pressed={kind === type}
							onClick={() => {
								setKind(kind === type ? "numeric" : type);
								write.changed();
							}}
						>
							{text}
						</button>
					))}
				</fieldset>
			) : null}
			<details>
				<summary>称呼（选填）</summary>
				<label>
					你的称呼
					<input
						maxLength={80}
						value={label}
						onChange={(e) => {
							setLabel(e.target.value);
							write.changed();
						}}
					/>
				</label>
			</details>
			{extraContent}
		</>
	);

	return (
		<form
			className={`issue-response-form stack${compact ? " guest-measurement-form" : ""}`}
			aria-label="提交回复"
			noValidate={compact}
			onSubmit={(e) => {
				e.preventDefault();
				const parsed = responseSchema.safeParse(draft);
				if (!parsed.success) {
					if (compact && kind !== "numeric") setExtrasOpen(true);
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
			{!compact ? (
				<h3>{issue.kind === "comment" ? "回复文件问题" : "提交本次测量"}</h3>
			) : null}
			<fieldset disabled={write.disabled}>
				{issue.kind === "measurement" && !compact ? (
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
							{compact
								? `${issue.state === "remeasure_requested" ? "重新填写" : "填写"}${issue.target && issue.measurementField ? measurementFieldLabel(issue.target.annotation, issue.measurementField) : "尺寸"}`
								: "测量数值"}
							<input
								required={kind === "numeric"}
								placeholder="输入实测值"
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
							{compact ? <span className="sr-only">测量单位</span> : "测量单位"}
							<select
								value={unit}
								onChange={(e) => {
									setUnit(e.target.value);
									write.changed();
								}}
							>
								{unitsForField(issue.measurementField).map((u) => (
									<option key={u} value={u}>
										{displayUnit(u)}
									</option>
								))}
							</select>
						</label>
					</div>
				) : null}
				{compact && kind === "text" ? (
					<label>
						补充说明
						<textarea
							aria-label="回复说明"
							required
							maxLength={4000}
							value={body}
							onChange={(e) => {
								setBody(e.target.value);
								write.changed();
							}}
						/>
					</label>
				) : null}
				{compact ? (
					<details
						className="guest-measurement-more"
						open={extrasOpen}
						onToggle={(e) => setExtrasOpen(e.currentTarget.open)}
					>
						<summary>
							{issue.kind === "comment"
								? "附件与其他信息"
								: "照片、说明或其他回复方式"}
						</summary>
						{extras}
					</details>
				) : (
					<>
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
					</>
				)}
			</fieldset>
			<button type="submit" disabled={write.busy || write.conflict}>
				{write.busy
					? "正在提交回复…"
					: write.blocked
						? "重试提交回复"
						: compact
							? kind === "photo"
								? "提交照片"
								: kind === "unable" || kind === "text"
									? "提交说明"
									: "提交尺寸"
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
