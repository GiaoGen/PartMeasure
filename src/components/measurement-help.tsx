"use client";

import { useState } from "react";
import type { MeasurementField } from "@/lib/annotation-collaboration";
import {
	caliperHelp,
	caliperPreparation,
	caliperReadings,
	measurementHelpFallback,
	type HelpArticle,
} from "@/lib/measurement-help";
import "./measurement-help.css";

function HelpArticleContent({ article }: { article: HelpArticle }) {
	const [imageFailed, setImageFailed] = useState(false);
	return (
		<>
			{imageFailed ? (
				<p className="measurement-help-note" role="status">
					示意图暂时无法显示，可按下方步骤操作。
					<button type="button" onClick={() => setImageFailed(false)}>重试图示</button>
				</p>
			) : (
				// biome-ignore lint/performance/noImgElement: local SVG diagrams need no raster optimizer and are only mounted after the help is expanded.
				<img
					className="measurement-help-illustration"
					src={article.image}
					alt={article.imageAlt}
					width={640}
					height={300}
					loading="lazy"
					decoding="async"
					onError={() => setImageFailed(true)}
				/>
			)}
			<ol>{article.steps.map(step => <li key={step}>{step}</li>)}</ol>
			<p className="measurement-help-note">{article.note}</p>
		</>
	);
}

function ReadingHelp({ article }: { article: HelpArticle }) {
	const [expanded, setExpanded] = useState(false);
	return (
		<details className="measurement-help-reading" onToggle={event => setExpanded(event.currentTarget.open)}>
			<summary>{article.title}</summary>
			{expanded ? <HelpArticleContent article={article} /> : null}
		</details>
	);
}

function HelpDisclosure({ article }: { article: HelpArticle }) {
	const [expanded, setExpanded] = useState(false);
	return (
		<details className="measurement-help" onToggle={event => setExpanded(event.currentTarget.open)}>
			<summary aria-label={`测量帮助：${article.title}`}>测量帮助</summary>
			{expanded ? (
				<div className="measurement-help-body">
					<p className="measurement-help-note">{caliperPreparation}</p>
					<h5>{article.title}</h5>
					<HelpArticleContent article={article} />
					<ReadingHelp article={caliperReadings.digital} />
					<ReadingHelp article={caliperReadings.vernier} />
					<p className="measurement-help-note">{measurementHelpFallback}</p>
				</div>
			) : null}
		</details>
	);
}

/** One optional disclosure; opening it never remounts or changes the reply form. */
export function MeasurementHelp({ method, field }: {
	method?: string | null | undefined;
	field?: MeasurementField | null | undefined;
}) {
	const article = field === "angleValue" ? null : caliperHelp(method);
	return article ? <HelpDisclosure key={method} article={article} /> : null;
}
