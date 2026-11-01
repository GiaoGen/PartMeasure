"use client";
import {
	geometryPaths,
	photoDimensionText,
	photoStatusText,
	annotationColor,
	labelPosition,
} from "@/lib/annotation-presentation";
import { annotationStatus } from "@/lib/annotation-collaboration";
import { useEffect, useRef, useState } from "react";
import type { AnnotationDocument } from "@/lib/annotations";
import { calloutLayout } from "@/lib/text-callout";
import { ApiError, readCached, observeApiVersion } from "./api";
import { readLayers } from "./interaction-reads";
import { useApiRevalidation } from "./use-api-revalidation";
import { annotationHitRegion } from "./annotation-hit-region";
import { annotationHitTolerance, pickAnnotation } from "./annotation-picker";
import { MaterialThumbnail } from "./workspace-ui";

export function AnnotatedThumbnail({
	base,
	fileId,
	name,
	refreshKey,
	thumbnail,
	annotationVersion,
	annotationCount,
	onInvalid,
	onBrowse,
	onAnnotation,
}: {
	base: string;
	fileId: string;
	name: string;
	refreshKey: number;
	thumbnail?:
		| { version: string; width: number; height: number }
		| null
		| undefined;
	annotationVersion?: string | undefined;
	annotationCount?: number | undefined;
	onInvalid: () => void;
	onBrowse?: () => void;
	onAnnotation?: (id: string) => void;
}) {
	const host = useRef<HTMLSpanElement>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });
	useEffect(() => {
		if (!host.current) return;
		const observer = new ResizeObserver(([entry]) => {
			if (entry)
				setSize({
					width: entry.contentRect.width,
					height: entry.contentRect.height,
				});
		});
		observer.observe(host.current);
		return () => observer.disconnect();
	}, []);
	const [visible, setVisible] = useState(false);
	const url = `${base}/files/${fileId}/annotations`;
	const [document, setDocument] = useState<AnnotationDocument | null>(() => readCached<AnnotationDocument>(url) ?? null);
	const [validation, setValidation] = useState(0);
	useApiRevalidation(() => { if (visible) setValidation(v => v + 1); });
	const [failed, setFailed] = useState(false);
	const [imageReady, setImageReady] = useState(false);
	const [highlighted, setHighlighted] = useState<string | null>(null);
	const touch = useRef(false);
	const hoverFrame = useRef<number | null>(null);
	const hoverPoint = useRef({ x: 0, y: 0 });
	useEffect(() => () => { if (hoverFrame.current !== null) cancelAnimationFrame(hoverFrame.current); }, []);
	useEffect(() => {
		if (!host.current) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				setVisible(!!entry?.isIntersecting);
			},
			{ rootMargin: "180px" },
		);
		observer.observe(host.current);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		void validation;
		if (!visible) return;
		if (annotationVersion) observeApiVersion(url, annotationVersion);
		if (annotationCount === 0 && refreshKey === 0) {
			setDocument(null);
			setFailed(false);
			return;
		}
		let active = true;
		const controller = new AbortController();
		void readLayers(base, fileId, { signal: controller.signal })
			.then((data) => {
				if (active) {
					setDocument(data);
					setFailed(false);
				}
			})
			.catch((error) => {
				if (!active || controller.signal.aborted) return;
				setFailed(true);
				if (error instanceof ApiError && error.status === 401) onInvalid();
			});
		return () => {
			active = false;
			controller.abort();
		};
	}, [
		url,
		base,
		fileId,
		validation,
		visible,
		refreshKey,
		annotationVersion,
		annotationCount,
		onInvalid,
	]);
	const items = document?.items.filter((item) => !item.deleted) ?? [];
	const w = document?.image.width ?? 1,
		h = document?.image.height ?? 1;
	function pick(clientX: number, clientY: number, isTouch: boolean) {
		const rect = host.current?.getBoundingClientRect();
		if (!rect || !document || !imageReady || !onAnnotation) return null;
		const scale = Math.min(rect.width / w, rect.height / h);
		return pickAnnotation(items, {
			x: (clientX - rect.left - (rect.width - w * scale) / 2) / scale,
			y: (clientY - rect.top - (rect.height - h * scale) / 2) / scale,
		}, w, h, scale, annotationHitTolerance(isTouch));
	}
	return (
		<span className="annotated-thumbnail" ref={host}>
			{onBrowse || onAnnotation ? (
				<button
					type="button"
					className="thumbnail-browse"
					onPointerDown={(event) => { touch.current = event.pointerType !== "mouse"; }}
					onPointerMove={(event) => {
						if (event.pointerType !== "mouse") return;
						hoverPoint.current = { x: event.clientX, y: event.clientY };
						if (hoverFrame.current === null) hoverFrame.current = requestAnimationFrame(() => {
							hoverFrame.current = null;
							setHighlighted(pick(hoverPoint.current.x, hoverPoint.current.y, false)?.id ?? null);
						});
					}}
					onPointerLeave={() => {
						if (hoverFrame.current !== null) cancelAnimationFrame(hoverFrame.current);
						hoverFrame.current = null;
						setHighlighted(null);
					}}
					onClick={(event) => {
						const hit = event.detail ? pick(event.clientX, event.clientY, touch.current) : null;
						if (hit) onAnnotation?.(hit.id); else onBrowse?.();
					}}
					aria-label={`打开 ${name}`}
				/>
			) : null}
			<MaterialThumbnail
				src={
					visible && thumbnail
						? `${base}/files/${fileId}/preview?variant=640`
						: undefined
				}
				version={thumbnail?.version}
				name={name}
				onReady={setImageReady}
			/>
			{document && imageReady ? (
				<svg
					className="thumbnail-annotations"
					viewBox={`0 0 ${w} ${h}`}
					role="img"
					aria-label={`${items.length} 个已保存标注`}
				>
					{items.map((item) => {
						const g = item.geometry;
						const color = annotationColor(item);
						const callout = g.type === "text" ? calloutLayout(g, w, h, Math.max(0.001, size.width / w)) : null;
						const scale = Math.max(0.001, size.width / w);
						const position = labelPosition(g, w, h, scale);
						return (
							<g key={item.id} className="thumbnail-annotation" data-highlighted={highlighted === item.id}>
								<g
									fill="none"
									stroke={color}
									strokeWidth="2.5"
									vectorEffect="non-scaling-stroke"
								>
									{geometryPaths(
										g,
										w,
										h,
										Math.max(0.001, Math.min(size.width / w, size.height / h)),
									)
										.map((data, i) => ({
											data,
											role: ["outline", "detail", "secondary"][i] ?? "extra",
										}))
										.map(({ data, role }) => (
											<path
												key={role}
												d={data}
												fill={
													g.type === "point"
														? color
														: "none"
												}
												vectorEffect="non-scaling-stroke"
											/>
										))}
								</g>
								{callout ? <text fill={color} stroke="white" strokeWidth={2 / scale} paintOrder="stroke" fontSize={callout.fontSize}>
									{callout.lines.map((text, i) => ({ text, y: callout.y + callout.fontSize + i * callout.lineHeight })).map(row => <tspan key={row.y} x={callout.x} y={row.y}>{row.text}</tspan>)}
								</text> : null}
								{g.type !== "text" && photoDimensionText(item) ? (
									<text
										x={
											labelPosition(g, w, h, Math.max(0.001, size.width / w)).x
										}
										y={
											labelPosition(g, w, h, Math.max(0.001, size.width / w)).y
										}
										fontSize={12 / Math.max(0.001, size.width / w)}
										textAnchor="middle"
										fill={color}
										stroke="white"
										strokeWidth={3 / Math.max(0.001, size.width / w)}
										paintOrder="stroke"
									>
										{photoDimensionText(item)}
									</text>
								) : null}
								{photoStatusText(item) ? (
									<text
										x={Math.max(
											30 / scale,
											Math.min(w - 30 / scale, position.x),
										)}
										y={Math.max(
											14 / scale,
											Math.min(
												h - 6 / scale,
												position.y +
													(photoDimensionText(item) ? 18 : 0) / scale,
											),
										)}
										fontSize={11 / scale}
										textAnchor="middle"
										fill={color}
										stroke="white"
										strokeWidth={3 / scale}
										paintOrder="stroke"
									>
										{photoStatusText(item)}
									</text>
								) : null}
							</g>
						);
					})}
				</svg>
			) : null}
			{document && onAnnotation && size.width > 0
				? items.map((item, index) => (
						<button
							key={item.id}
							type="button"
							className="thumbnail-annotation-hit"
							data-annotation-id={item.id}
							style={annotationHitRegion(item.geometry, document.image, size)}
							aria-label={`查看标注 ${index + 1}：${item.metadata.name || "图片标注"}${annotationStatus(item) ? ` · ${annotationStatus(item)}` : ""}`}
							onClick={() => onAnnotation(item.id)}
							onFocus={() => setHighlighted(item.id)}
							onBlur={() => setHighlighted(null)}
						/>
					))
				: null}
			{!document && !failed && (annotationCount !== 0 || refreshKey > 0) ? (
				<span className="thumbnail-state">载入标注…</span>
			) : null}
			{failed ? (
				<span className="thumbnail-state">标注未载入 · 点击重试</span>
			) : null}
		</span>
	);
}
