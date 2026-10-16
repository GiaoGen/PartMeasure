export default function Page() {
	return (
		<main className="auth-page">
			<p className="brand">PartMeasure</p>
			<h1>零件资料，清楚交接。</h1>
			<p>工程师创建项目，客户通过专属链接上传照片与附件。</p>
			<a className="button primary" href="/login">
				工程师登录
			</a>
			<p className="muted">
				客户请打开工程师发来的项目链接，无需注册。测量与成果发布将在后续阶段开放。
			</p>
		</main>
	);
}
