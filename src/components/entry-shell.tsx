import type { ReactNode } from "react";

export function EntryShell({
	eyebrow,
	title,
	description,
	children,
}: {
	eyebrow: string;
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<main className="entry-page">
			<header className="entry-topbar">
				<a className="brand" href="/">
					PartMeasure
				</a>
				<a className="entry-home" href="/projects" aria-label="我的项目">
					<span className="entry-sr-only">我的项目</span>
					<svg
						viewBox="0 0 24 24"
						width="22"
						height="22"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.7"
						aria-hidden="true"
					>
						<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
					</svg>
				</a>
			</header>
			<div className="entry-layout">
				<section className="entry-intro" aria-label={eyebrow}>
					<p className="entry-eyebrow">{eyebrow}</p>
					<h2>{title}</h2>
					<p>{description}</p>
					<ol className="entry-steps">
						<li>整理资料</li>
						<li>标注与测量</li>
						<li>交付成果</li>
					</ol>
				</section>
				<section className="entry-content">{children}</section>
			</div>
		</main>
	);
}
