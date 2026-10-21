"use client";
import { useId, useState } from "react";
import { type AnnotationDraft, typeLabel } from "@/lib/annotations";
import { methodLabel } from "@/lib/issues";
import {
	annotationColor,
	photoDimensionText,
} from "@/lib/annotation-presentation";
import { AnnotationCollaboration } from "./annotation-collaboration";

export function GuestAnnotationPanel({
	item,
	base,
	fileId,
	refreshKey,
	onInvalid,
	onUpdated,
	onDirty,
}: {
	item: AnnotationDraft;
	base: string;
	fileId: string;
	refreshKey: number;
	onInvalid: () => void;
	onUpdated: () => void;
	onDirty: (dirty: boolean) => void;
}) {
	const [notesOpen, setNotesOpen] = useState(false),
		notesId = useId();
	const metadata = item.metadata,
		method = metadata.measurementMethod;
	const hasLiveReply = !!(
		item.collaboration?.pending ||
		item.collaboration?.submitted ||
		item.collaboration?.remeasure
	);
	return (
		<section
			className="guest-annotation-panel"
			aria-label={`${metadata.name || typeLabel(item.geometry)}测量信息`}
		>
			<header className="guest-annotation-heading">
				<h3>
					<span
						className="guest-annotation-dot"
						style={{ backgroundColor: annotationColor(item) }}
						aria-hidden="true"
					/>
					{metadata.name || typeLabel(item.geometry)}
				</h3>
				{metadata.notes.trim() ? (
					<button
						type="button"
						className="guest-annotation-note-button"
						aria-label="查看工程师备注"
						aria-expanded={notesOpen}
						aria-controls={notesId}
						onClick={() => setNotesOpen((open) => !open)}
					>
						<span aria-hidden="true">!</span>
					</button>
				) : null}
			</header>
			{metadata.notes.trim() ? (
				<div id={notesId} hidden={!notesOpen} className="guest-annotation-note">
					<small>工程师备注</small>
					<p className="preserve-lines">{metadata.notes}</p>
				</div>
			) : null}
			{!hasLiveReply &&
			((method && method !== "unspecified") ||
				metadata.measurementInstructions?.trim()) ? (
				<div className="guest-annotation-guidance">
					{method && method !== "unspecified" ? (
						<div>
							<small>测量方式</small>
							<p>{methodLabel[method]}</p>
						</div>
					) : null}
					{metadata.measurementInstructions?.trim() ? (
						<div>
							<small>测量说明</small>
							<p className="preserve-lines">
								{metadata.measurementInstructions}
							</p>
						</div>
					) : null}
				</div>
			) : null}
			{item.geometry.type === "text" ? (
				<p className="preserve-lines">{item.geometry.text}</p>
			) : null}
			{photoDimensionText(item) &&
			!item.collaboration?.pending &&
			!item.collaboration?.remeasure &&
			!item.collaboration?.submitted ? (
				<p className="guest-annotation-value">{photoDimensionText(item)}</p>
			) : null}
			<AnnotationCollaboration
				base={base}
				fileId={fileId}
				annotationId={item.id}
				guest
				compact
				refreshKey={refreshKey}
				onInvalid={onInvalid}
				onUpdated={onUpdated}
				onDirty={onDirty}
			/>
		</section>
	);
}
