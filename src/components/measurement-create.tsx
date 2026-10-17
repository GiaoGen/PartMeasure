"use client";
import { useState } from "react";
import type { Annotation, CanonicalImage } from "@/lib/annotations";
import { measurementSchema, methodLabel } from "@/lib/issues";
import { useIssueWrite } from "./use-issue-write";
export function MeasurementCreate({
	base,
	fileId,
	annotation,
	image,
	onCreated,
	onInvalid,
	onDirty,
}: {
	base: string;
	fileId: string;
	annotation: Annotation;
	image: CanonicalImage;
	onCreated: () => void;
	onInvalid: () => void;
	onDirty: (dirty: boolean) => void;
}) {
	const [title, setTitle] = useState(annotation.metadata.name || "请补充测量"),
		[targetInfo, setTargetInfo] = useState(""),
		[description, setDescription] = useState(""),
		[method, setMethod] = useState<keyof typeof methodLabel>("unspecified");
	const [created, setCreated] = useState(false);
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
	const draft = {
		kind: "measurement" as const,
		fileId,
		annotationRef: { id: annotation.id, revision: annotation.revision },
		title,
		targetInfo,
		description,
		measurementMethod: method,
	};
	if (created)
		return (
			<section className="measurement-create">
				<p role="status">测量请求已创建，可在上方任务列表中查看。</p>
				<button
					type="button"
					onClick={() => {
						setCreated(false);
						setTargetInfo("");
						setDescription("");
						write.changed();
					}}
				>
					新建另一条请求
				</button>
			</section>
		);
	return (
		<details className="measurement-create">
			<summary>创建测量请求</summary>
			<p>
				固定当前标注修订 #{annotation.revision} · 标准图 {image.width}×
				{image.height}。后续编辑标注不会移动本请求的位置。
			</p>
			<form
				className="stack"
				onSubmit={(e) => {
					e.preventDefault();
					const parsed = measurementSchema.safeParse(draft);
					if (!parsed.success) {
						write.setError("请填写题目、目标信息，并检查长度。");
						return;
					}
					void write.submit(parsed.data);
				}}
			>
				<fieldset disabled={write.disabled}>
					<label>
						请求题目
						<input
							required
							maxLength={120}
							value={title}
							onChange={(e) => {
								setTitle(e.target.value);
								write.changed();
							}}
						/>
					</label>
					<label>
						目标信息
						<textarea
							aria-label="目标信息"
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
						操作要求
						<textarea
							aria-label="操作要求"
							maxLength={4000}
							value={description}
							onChange={(e) => {
								setDescription(e.target.value);
								write.changed();
							}}
						/>
					</label>
				</fieldset>
				<button type="submit" disabled={write.busy || write.conflict}>
					{write.busy
						? "创建中…"
						: write.blocked
							? "重试创建请求"
							: "保存测量请求"}
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
