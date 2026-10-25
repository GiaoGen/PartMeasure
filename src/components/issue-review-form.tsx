"use client";
import { useState } from "react";
import type {
	IssueDetail,
	IssueWriteResult,
	ReviewInput,
} from "@/lib/issues";
import { useIssueWrite } from "./use-issue-write";

/** The only new engineer action after a reply is requesting more information. */
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
	const [note, setNote] = useState("");
	const write = useIssueWrite<IssueWriteResult>(
		`${base}/issues/${issue.id}/review`,
		issue.revision,
		onSaved,
		onInvalid,
		onDirty,
	);
	if (!response) return <p role="alert">当前回复尚未载入，请重试读取记录。</p>;
	const draft: ReviewInput = {
		decision: "remeasure",
		responseId: response.id,
		value: null,
		unit: null,
		source: null,
		note,
	};
	return (
		<details className="issue-review-form">
			<summary>
				{issue.kind === "comment" ? "要求补充说明" : "要求补测"}
			</summary>
			<form
				className="stack"
				aria-label="要求补充"
				onSubmit={(e) => {
					e.preventDefault();
					if (!note.trim()) {
						write.setError("请说明需要补充或重新测量的原因。");
						return;
					}
					void write.submit(draft);
				}}
			>
				<label>
					补充说明
					<textarea
						required
						maxLength={4000}
						value={note}
						disabled={write.disabled}
						onChange={(e) => {
							setNote(e.target.value);
							write.changed();
						}}
					/>
				</label>
				<button type="submit" disabled={write.busy || write.conflict || write.readOnly}>
					{write.busy
						? "正在保存…"
						: write.blocked
							? "重试要求补充"
							: issue.kind === "comment"
								? "要求补充说明"
								: "要求补测"}
				</button>
				<p role="status">{write.status}</p>
				{write.error ? (
					<p role="alert" className="error">
						{write.error}
					</p>
				) : null}
				{write.blocked ? (
					<div className="save-recovery">
						<p>内容仍保留；若有冲突，请复制后重新载入。</p>
						<button
							type="button"
							onClick={async () => {
								try {
									await navigator.clipboard.writeText(note);
									write.setError("补充说明已复制。");
								} catch {
									write.setError("复制未完成，请保留本页。");
								}
							}}
						>
							复制说明
						</button>
						<button
							type="button"
							onClick={() => {
								if (window.confirm("重新载入将放弃未保存的输入，继续？"))
									onReload();
							}}
						>
							重新载入
						</button>
					</div>
				) : null}
			</form>
		</details>
	);
}
