"use client";
import { unitsForField, displayUnit } from "@/lib/annotation-collaboration";
import { useState } from "react";
import {
	type IssueDetail,
	type IssueWriteResult,
	type ReviewInput,
	reviewSchema,
	validateReview,
} from "@/lib/issues";
import { useIssueWrite } from "./use-issue-write";
export function IssueReviewForm({
	base,
	issue,
	onSaved,
	onInvalid,
	onDirty,
	onReload,
}: {
	base: string;
	issue: IssueDetail;
	onSaved: (result: IssueWriteResult) => void;
	onInvalid: () => void;
	onDirty: (dirty: boolean) => void;
	onReload: () => void;
}) {
	const response = issue.responses.find((r) => r.id === issue.latestResponseId);
	const [decision, setDecision] = useState<"confirm" | "remeasure">("confirm"),
		[source, setSource] = useState<ReviewInput["source"]>(
			issue.kind === "comment"
				? "comment"
				: response?.kind === "numeric"
					? "customer_numeric"
					: response?.kind === "photo"
						? "owner_from_photo"
						: "owner_manual",
		),
		[value, setValue] = useState(response?.value ?? ""),
		[unit, setUnit] = useState(
			response?.unit ??
				(issue.measurementField === "angleValue" ? "deg" : "mm"),
		),
		[note, setNote] = useState("");
	const write = useIssueWrite<IssueWriteResult>(
		`${base}/issues/${issue.id}/review`,
		issue.revision,
		onSaved,
		onInvalid,
		onDirty,
	);
	if (!response)
		return <p role="alert">当前回复尚未载入，请重试读取任务后审核。</p>;
	const draft: ReviewInput = {
		decision,
		responseId: response.id,
		value:
			decision === "confirm" && issue.kind === "measurement" ? value : null,
		unit:
			decision === "confirm" && issue.kind === "measurement"
				? (unit as ReviewInput["unit"])
				: null,
		source: decision === "confirm" ? source : null,
		note,
	};
	return (
		<form
			className="issue-review-form stack"
			aria-label="工程师审核"
			onSubmit={(e) => {
				e.preventDefault();
				const parsed = reviewSchema.safeParse(draft);
				if (!parsed.success) {
					write.setError("请检查最终值、单位及审核说明。");
					return;
				}
				try {
					validateReview(issue.kind, response, parsed.data);
				} catch {
					write.setError(
						"修正/人工录入需选择人工来源并填写说明；采用原数值时必须保持原值和单位。要求重测必须说明原因。",
					);
					return;
				}
				void write.submit(parsed.data);
			}}
		>
			<h3>审核最新回复</h3>
			<p>原回复和证据会永久保留，本次审核只追加记录。</p>
			<fieldset disabled={write.disabled}>
				<label>
					审核决定
					<select
						value={decision}
						onChange={(e) => {
							setDecision(e.target.value as typeof decision);
							write.changed();
						}}
					>
						<option value="confirm">
							{issue.kind === "comment" ? "确认已处理" : "确认测量结果"}
						</option>
						<option value="remeasure">
							{issue.kind === "comment" ? "要求补充说明" : "要求重新测量"}
						</option>
					</select>
				</label>
				{decision === "confirm" && issue.kind === "measurement" ? (
					<>
						<label>
							最终值来源
							<select
								value={source ?? "owner_manual"}
								onChange={(e) => {
									const next = e.target.value as ReviewInput["source"];
									setSource(next);
									if (next === "customer_numeric") {
										setValue(response.value ?? "");
										setUnit(response.unit ?? "mm");
									}
									write.changed();
								}}
							>
								{response.kind === "numeric" ? (
									<option value="customer_numeric">采用客户原数值</option>
								) : null}
								{response.kind === "photo" ? (
									<option value="owner_from_photo">依据测量照片人工录入</option>
								) : null}
								<option value="owner_manual">工程师人工录入／修正</option>
							</select>
						</label>
						<div className="numeric-entry">
							<label>
								最终确认值
								<input
									inputMode="decimal"
									required
									maxLength={24}
									value={value}
									onChange={(e) => {
										setValue(e.target.value);
										write.changed();
									}}
								/>
							</label>
							<label>
								确认单位
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
					</>
				) : null}
				<label>
					审核说明
					<textarea
						aria-label="审核说明"
						required={
							decision === "remeasure" ||
							(issue.kind === "measurement" && source !== "customer_numeric")
						}
						maxLength={4000}
						value={note}
						onChange={(e) => {
							setNote(e.target.value);
							write.changed();
						}}
					/>
				</label>
				<p className="muted">
					人工值由工程师负责核对；不会自动读尺或从像素推算尺寸。
				</p>
			</fieldset>
			<button type="submit" disabled={write.busy || write.conflict}>
				{write.busy
					? "正在保存审核…"
					: write.blocked
						? "重试保存审核"
						: "保存审核决定"}
			</button>
			<p role="status">{write.status}</p>
			{write.error ? (
				<p role="alert" className="error">
					{write.error}
				</p>
			) : null}
			{write.blocked ? (
				<div className="save-recovery">
					<p>审核尚未确认，内容保留；冲突时请复制后重新载入。</p>
					<button
						type="button"
						onClick={async () => {
							try {
								await navigator.clipboard.writeText(
									JSON.stringify(draft, null, 2),
								);
								write.setError("审核草稿已复制。");
							} catch {
								write.setError("复制未完成，请保留本页。");
							}
						}}
					>
						复制审核草稿
					</button>
					<button
						type="button"
						onClick={() => {
							if (window.confirm("重新载入将放弃本页未保存的审核输入，继续？"))
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
