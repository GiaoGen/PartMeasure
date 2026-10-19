import { EntryShell } from "@/components/entry-shell";
export default function Loading() {
	return (
		<EntryShell
			eyebrow="PartMeasure"
			title="进入你的协作空间。"
			description="资料、测量与成果，在这里清楚交接。"
		>
			<span className="entry-spinner" aria-hidden="true" />
			<h1>正在加载…</h1>
			<p className="muted" role="status">
				请稍候。
			</p>
		</EntryShell>
	);
}
