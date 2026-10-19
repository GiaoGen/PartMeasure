"use client";
import { EntryShell } from "@/components/entry-shell";
export default function ErrorPage({
	retry,
}: {
	error: unknown;
	retry: () => void;
}) {
	return (
		<EntryShell
			eyebrow="暂时中断"
			title="稍后继续协作。"
			description="返回项目，继续整理资料与测量。"
		>
			<h1>页面暂时无法加载</h1>
			<p className="muted" role="alert">
				请重试，或返回项目列表。
			</p>
			<div className="actions">
				<button className="primary" type="button" onClick={retry}>
					重新加载
				</button>
				<a className="button" href="/projects">
					我的项目
				</a>
			</div>
		</EntryShell>
	);
}
