"use client";
import { annotationStatus } from "@/lib/annotation-collaboration";
import { useEffect, useRef, useState } from "react";
import type { AnnotationDocument } from "@/lib/annotations";
import { api, ApiError } from "./api";
import { annotationHitRegion } from "./annotation-hit-region";
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
	thumbnail?: {version:string;width:number;height:number}|null|undefined;
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
	const [document, setDocument] = useState<AnnotationDocument | null>(null);
	const [failed, setFailed] = useState(false);
	const [imageReady,setImageReady] = useState(false);
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
		if (!visible) return;
		if (annotationCount === 0 && refreshKey === 0) {
			setDocument(null);
			setFailed(false);
			return;
		}
		let active = true;
		void api<AnnotationDocument>(`${base}/files/${fileId}/annotations`, "GET", undefined, {
			cacheMs: 5000, cacheVersion: `${annotationVersion ?? "unknown"}:${refreshKey}`,
		})
			.then((data) => {
				if (active) {
					setDocument(data);
					setFailed(false);
				}
			})
			.catch((error) => {
				if (!active) return;
				setFailed(true);
				if (error instanceof ApiError && error.status === 401) onInvalid();
			});
		return () => {
			active = false;
		};
	}, [base, fileId, visible, refreshKey, annotationVersion, annotationCount, onInvalid]);
	const items = document?.items.filter((item) => !item.deleted) ?? [];
	const w = document?.image.width ?? 1,
		h = document?.image.height ?? 1;
	const labelSize = Math.max(w, h) / 26;
	return (
		<span className="annotated-thumbnail" ref={host}>
			{onBrowse ? (
				<button
					type="button"
					className="thumbnail-browse"
					onClick={onBrowse}
					aria-label={`打开 ${name}`}
				/>
			) : null}
			<MaterialThumbnail src={visible && thumbnail ? `${base}/files/${fileId}/preview?variant=640` : undefined} version={thumbnail?.version} name={name} onReady={setImageReady} />
			{document && imageReady ? (
				<svg
					className="thumbnail-annotations"
					viewBox={`0 0 ${w} ${h}`}
					role="img"
					aria-label={`${items.length} 个已保存标注`}
				>
					{items.map((item, index) => {
						const g = item.geometry;
						const p =
							g.type === "line"
								? g.from
								: g.type === "circle"
									? g.center
									: g.at;
						return (
							<g key={item.id}>
								<g
									fill="none"
									stroke="var(--workspace-mark)"
									strokeWidth="2.5"
									vectorEffect="non-scaling-stroke"
								>
									{g.type === "line" ? (
										<line
											x1={g.from.x * w}
											y1={g.from.y * h}
											x2={g.to.x * w}
											y2={g.to.y * h}
											vectorEffect="non-scaling-stroke"
										/>
									) : null}
									{g.type === "circle" ? (
										<ellipse
											cx={g.center.x * w}
											cy={g.center.y * h}
											rx={g.radiusX * w}
											ry={g.radiusY * h}
											vectorEffect="non-scaling-stroke"
										/>
									) : null}
									{g.type === "point" ? (
										<circle
											cx={g.at.x * w}
											cy={g.at.y * h}
											r={labelSize / 5}
											fill="var(--workspace-mark)"
										/>
									) : null}
								</g>
								{g.type === "text" ? (
									<text
										x={p.x * w}
										y={p.y * h}
										fontSize={labelSize}
										fill="var(--workspace-mark)"
										stroke="#fff"
										strokeWidth={labelSize / 9}
										paintOrder="stroke"
									>
										{g.text}
									</text>
								) : null}
								<circle
									cx={Math.max(labelSize, Math.min(w - labelSize, p.x * w))}
									cy={Math.max(labelSize, p.y * h - labelSize)}
									r={labelSize * 0.65}
									fill="var(--workspace-mark)"
								/>
								<text
									x={Math.max(labelSize, Math.min(w - labelSize, p.x * w))}
									y={Math.max(labelSize, p.y * h - labelSize)}
									textAnchor="middle"
									dominantBaseline="central"
									fontSize={labelSize * 0.8}
									fill="#fff"
								>
									{index + 1}{annotationStatus(item) ? "·" : ""}
								</text>
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
						/>
					))
				: null}
			{!document && !failed ? (
				<span className="thumbnail-state">载入标注…</span>
			) : null}
			{failed ? (
				<span className="thumbnail-state">标注未载入 · 点击重试</span>
			) : null}
		</span>
	);
}
