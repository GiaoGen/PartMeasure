import type { Geometry, Point } from "../../src/lib/annotations";

type Path = Point[];
const pixel = (p: Point, w: number, h: number) => ({ x: p.x * w, y: p.y * h });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function paths(g: Geometry, w: number, h: number): Path[] {
	if (g.type === "line") return [[pixel(g.from, w, h), pixel(g.to, w, h)]];
	if (g.type === "angle") return [[pixel(g.from, w, h), pixel(g.vertex, w, h)], [pixel(g.vertex, w, h), pixel(g.to, w, h)]];
	if (g.type !== "circle" && g.type !== "ellipse") throw Error("UNSUPPORTED_METRIC_GEOMETRY");
	const c = pixel(g.center, w, h);
	const a = g.type === "circle" ? { x: g.radiusX * w, y: 0 } : { x: g.axisA.x * w - c.x, y: g.axisA.y * h - c.y };
	const b = g.type === "circle" ? { x: 0, y: g.radiusY * h } : { x: g.axisB.x * w - c.x, y: g.axisB.y * h - c.y };
	return [Array.from({ length: 181 }, (_, i) => {
		const t = i * 2 * Math.PI / 180;
		return { x: c.x + a.x * Math.cos(t) + b.x * Math.sin(t), y: c.y + a.y * Math.cos(t) + b.y * Math.sin(t) };
	})];
}
function samples(path: Path): Point[] {
	if (path.length !== 2) return path.slice(0, -1);
	const a = path[0], b = path[1];
	if (!a || !b) throw Error("EMPTY_METRIC_PATH");
	return Array.from({ length: 33 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / 32, y: a.y + (b.y - a.y) * i / 32 }));
}
function segmentDistance(p: Point, a: Point, b: Point) {
	const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
	const t = lengthSquared ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0;
	return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}
export const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] ?? null;

// Symmetric sampled point-to-segment contour distance, in canonical pixels.
// Axis sign/parameterization do not change ellipse scores. This measures image
// contours only, never millimetres, physical angles or task completion time.
export function contourError(a: Geometry, b: Geometry, w: number, h: number) {
	const aPaths = paths(a, w, h), bPaths = paths(b, w, h);
	const directed = (source: Path[], target: Path[]) => source.flatMap(samples).map(p => {
		let best = Number.POSITIVE_INFINITY;
		for (const path of target) for (let i = 1; i < path.length; i++) {
			const from = path[i - 1], to = path[i];
			if (from && to) best = Math.min(best, segmentDistance(p, from, to));
		}
		return best;
	});
	const errors = [...directed(aPaths, bPaths), ...directed(bPaths, aPaths)];
	const vertexPx = a.type === "angle" && b.type === "angle" ? distance(pixel(a.vertex, w, h), pixel(b.vertex, w, h)) : null;
	return { meanPx: errors.reduce((n, v) => n + v, 0) / errors.length, p95Px: percentile(errors, .95) ?? 0, vertexPx };
}
