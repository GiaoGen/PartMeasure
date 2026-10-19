import { EntryShell } from "@/components/entry-shell";
export default function NotFound() {
	return (
		<EntryShell
			eyebrow="404"
			title="回到你的项目。"
			description="照片、测量与成果，都从项目开始。"
		>
			<h1>找不到这个页面</h1>
			<p className="muted">请检查地址，或返回项目列表。</p>
			<a className="button primary" href="/projects">
				我的项目
			</a>
		</EntryShell>
	);
}
