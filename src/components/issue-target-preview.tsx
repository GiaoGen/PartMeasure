"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import type { CanonicalImage } from "@/lib/annotations";
import type { IssueCurrent } from "@/lib/issues";

const Canvas = dynamic(() => import("./annotation-canvas"), {
	ssr: false,
	loading: () => <p role="status">载入目标画布…</p>,
});
const noop = () => {};
export type TargetStatus = { pending: number; remeasure: number; submitted: number };

/** The photo lives independently of the selected task's form and immutable snapshot. */
export function IssueTargetPreview({ base, issue, image, status, onInvalid }: {
	base: string;
	issue: IssueCurrent | null;
	image: CanonicalImage;
	status?: TargetStatus;
	onInvalid: () => void;
}) {
	const [error, setError] = useState("");
	const target = issue?.target;
	return (
		<section className="task-target-preview" aria-label="标准图片与当前标注" aria-busy={!target}>
			<Canvas
				showToolbar={false}
				image={image}
				src={`${base}/files/${image.id}/preview`}
				items={target && issue ? [{
					...target.annotation,
					collaboration: {
						pending: !issue.closedAt && issue.state === "awaiting_response" ? 1 : 0,
						remeasure: !issue.closedAt && issue.state === "remeasure_requested" ? 1 : 0,
						submitted: issue.state === "submitted" ? 1 : 0,
						...status,
						values: Object.fromEntries(issue.responses.flatMap(r =>
							issue.measurementField && r.id === issue.latestResponseId && r.kind === "numeric" && r.value && r.unit
								? [[issue.measurementField, { value: r.value, unit: r.unit }]] : [])),
					},
				}] : []}
				selected={target?.annotationRef.id ?? null}
				guest disabled
				onSelect={noop} onCreate={noop} onChange={noop} onDelete={noop}
				onUndo={noop} onRedo={noop} onSave={noop}
				onError={setError} onInvalid={onInvalid}
			/>
			{error ? <p role="alert" className="error">{error}</p> : null}
		</section>
	);
}
