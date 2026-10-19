"use client";
import { useRef, useState } from "react";
import {
	type Annotation,
	type AnnotationDraft,
	typeLabel,
} from "@/lib/annotations";
import { methodLabel } from "@/lib/issues";
import { prepareMeasurementReminder } from "./measurement-reminder";
import { useIssueWrite } from "./use-issue-write";
export function MeasurementCreate({
	base,
	fileId,
	annotation,
	prepare,
	disabled = false,
	onCreated,
	onInvalid,
	onDirty,
}: {
	base: string;
	fileId: string;
	annotation: AnnotationDraft;
	prepare: () => Promise<Annotation | undefined>;
	disabled?: boolean;
	onCreated: () => void;
	onInvalid: () => void;
	onDirty: (dirty: boolean) => void;
}) {
	const [targetInfo, setTargetInfo] = useState(""),
		[description, setDescription] = useState(""),
		[method, setMethod] = useState<keyof typeof methodLabel>("unspecified");
	const [created, setCreated] = useState(false);
	const [preparing, setPreparing] = useState(false);
	const preparingRef = useRef(false);
	const write = useIssueWrite(
		`${base}/issues`,
		undefined,
		() => {
			setCreated(true);
			onCreated();
		},
		onInvalid,
		onDirty,
	);
	const title =
		annotation.metadata.name || `${typeLabel(annotation.geometry)}测量`;
	const draft = {
		kind: "measurement" as const,
		fileId,
		annotationId: annotation.id,
		title,
		targetInfo,
		description,
		measurementMethod: method,
	};
	if (created)
		return (
			<section className="measurement-create">
				<p role="status">测量提醒已发送。</p>
				<button
					type="button"
					onClick={() => {
						setCreated(false);
						setTargetInfo("");
						setDescription("");
						write.changed();
					}}
				>
					另发一条提醒
				</button>
			</section>
		);
	return (
		<details
			className="measurement-create"
			open={annotation.geometry.type !== "text"}
		>
			<summary>需要客户测量</summary>
			<form
				className="stack"
				onSubmit={async (e) => {
					e.preventDefault();
					if (preparingRef.current || disabled) return;
					preparingRef.current = true;
					setPreparing(true);
					try {
						const request = await prepareMeasurementReminder(draft, prepare);
						await write.submit(request);
					} catch (error) {
						write.setError(
							error instanceof Error ? error.message : "发送未完成，请重试。",
						);
					} finally {
						preparingRef.current = false;
						setPreparing(false);
					}
				}}
			>
				<fieldset disabled={write.disabled || disabled || preparing}>
					<label>
						测量要求
						<textarea
							aria-label="测量要求"
							required
							maxLength={2000}
							placeholder="例如：测量所标孔的内径，填写毫米或上传测量照片"
							value={targetInfo}
							onChange={(e) => {
								setTargetInfo(e.target.value);
								write.changed();
							}}
						/>
					</label>
					<label>
						建议测量方式
						<select
							value={method}
							onChange={(e) => {
								setMethod(e.target.value as keyof typeof methodLabel);
								write.changed();
							}}
						>
							{Object.entries(methodLabel).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
					</label>
					<label>
						补充说明（选填）
						<textarea
							aria-label="补充说明（选填）"
							maxLength={4000}
							value={description}
							onChange={(e) => {
								setDescription(e.target.value);
								write.changed();
							}}
						/>
					</label>
				</fieldset>
				<button
					type="submit"
					disabled={write.busy || write.conflict || disabled || preparing}
				>
					{write.busy || preparing
						? "发送中…"
						: write.blocked
							? "重试发送"
							: "发送测量提醒"}
				</button>
				<p role="status">{write.status}</p>
				{write.error ? (
					<p role="alert" className="error">
						{write.error}
					</p>
				) : null}
				{write.blocked ? (
					<p>
						输入已保留。
						{write.conflict
							? "请保留输入并重新选择最新标注后创建。"
							: "重试沿用原请求，不重复创建。"}
					</p>
				) : null}
			</form>
		</details>
	);
}
