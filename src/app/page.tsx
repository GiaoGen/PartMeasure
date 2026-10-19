import { EntryShell } from "@/components/entry-shell";
export default function Page() {
	return (
		<EntryShell
			eyebrow="工程资料协作"
			title="从一张照片，到清楚交付。"
			description="将零件照片、测量信息与成果文件放在同一个项目里。"
		>
			<h1>零件资料，清楚交接。</h1>
			<p className="muted">
				工程师整理与标注，客户打开链接即可上传资料、回复测量。
			</p>
			<a className="button primary" href="/login">
				工程师登录
			</a>
			<p className="muted">客户无需注册，请打开工程师分享的项目链接。</p>
		</EntryShell>
	);
}
