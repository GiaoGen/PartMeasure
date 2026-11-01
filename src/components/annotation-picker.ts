import type { AnnotationDraft, Geometry, Point } from "@/lib/annotations";
import { geometryPaths, labelPosition, photoDimensionText } from "@/lib/annotation-presentation";
import { calloutLayout } from "@/lib/text-callout";

type CachedPaths = { width: number; height: number; scale: number; paths: Path2D[] };
const cache = new WeakMap<Geometry, CachedPaths>();
let context: CanvasRenderingContext2D | null = null;
export const annotationHitTolerance = (touch: boolean) => touch ? 10 : 5;

/** Only visible strokes and actual text blocks participate; bounding boxes never fill a shape. */
export function pickAnnotation(
	items: readonly AnnotationDraft[], point: Point,
	width: number, height: number, scale: number, tolerance: number,
): AnnotationDraft | null {
	if (!(scale > 0) || point.x < 0 || point.y < 0 || point.x > width || point.y > height) return null;
	context ??= document.createElement("canvas").getContext("2d");
	if (!context) return null;
	context.lineCap = "round";
	context.lineJoin = "round";
	let closest: AnnotationDraft | null = null, distance = tolerance + 1;
	for (const item of items) {
		const g = item.geometry;
		let entry = cache.get(g);
		if (!entry || entry.width !== width || entry.height !== height || entry.scale !== scale) {
			entry = { width, height, scale, paths: geometryPaths(g, width, height, scale).map(path => new Path2D(path)) };
			cache.set(g, entry);
		}
		let candidate = Number.POSITIVE_INFINITY;
		if (g.type === "point" && entry.paths.some(path => context?.isPointInPath(path, point.x, point.y))) candidate = 0;
		const label = g.type === "text" ? calloutLayout(g, width, height, scale)
			: photoDimensionText(item) ? (() => {
				const p = labelPosition(g, width, height, scale);
				if (context) context.font = `${14 / scale}px Arial`;
				const textWidth = Math.min(180 / scale, (context?.measureText(photoDimensionText(item)).width ?? 0) + 6 / scale);
				return { x: Math.max(0, Math.min(width - 180 / scale, p.x - 90 / scale)) + (180 / scale - textWidth) / 2, y: Math.max(0, Math.min(height - 42 / scale, p.y - 14 / scale)), width: textWidth, height: 22 / scale };
			})() : null;
		if (label && point.x >= label.x && point.x <= label.x + label.width && point.y >= label.y && point.y <= label.y + label.height) candidate = 0;
		for (const path of entry.paths) {
			context.lineWidth = 2 * tolerance / scale;
			if (!context.isPointInStroke(path, point.x, point.y)) continue;
			let lo = 0, hi = tolerance;
			for (let i = 0; i < 7; i++) {
				const mid = (lo + hi) / 2;
				context.lineWidth = Math.max(0.01, 2 * mid / scale);
				if (context.isPointInStroke(path, point.x, point.y)) hi = mid; else lo = mid;
			}
			candidate = Math.min(candidate, hi);
		}
		// Exact ties keep the existing last-painted order; a nearer line wins regardless of order.
		if (candidate <= tolerance && candidate <= distance + 0.01) { closest = item; distance = candidate; }
	}
	return closest;
}
