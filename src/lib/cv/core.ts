import type * as CV from "@techstark/opencv-js";
import type { Geometry, Point } from "../annotations";
import { emptyMetadata, validateAnnotation } from "../annotations";

export const configuration = Object.freeze({
	version: "p1-03-probe-2",
	cannyLow: 50, cannyHigh: 150, maxContours: 2000, maxCandidates: 12,
	minRadius: 7, minCoverage: 0.8, maxRadialResidual: 0.12,
	circleAxisRatio: 0.92, minEllipseAxisRatio: 0.18,
	maxPixels: 1024 * 1024,
});
export type PixelEllipse = { x: number; y: number; rx: number; ry: number; angle: number };
export type Candidate = {
	geometry: Geometry; quality: number; coverage: number | null; residual: number | null;
	pixel: PixelEllipse;
};
export type LocalResult = { input: Geometry; output: Geometry; changed: boolean; reason: string; milliseconds: number };
type Region = { x: number; y: number; width: number; height: number };
export type PixelLine = { from: Point; to: Point };
export type Detections = { lines: PixelLine[]; rounds: Candidate[] };
type Detector = { lines: (box: Region, length: number) => PixelLine[]; rounds: (box: Region) => Candidate[] };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const point = (p: Point, w: number, h: number) => ({ x: p.x * w, y: p.y * h });
const normalized = (p: Point, w: number, h: number) => ({ x: p.x / w, y: p.y / h });
const inside = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
function region(points: Point[], margin: number, w: number, h: number): Region {
	const x = Math.max(0, Math.floor(Math.min(...points.map(p => p.x)) - margin));
	const y = Math.max(0, Math.floor(Math.min(...points.map(p => p.y)) - margin));
	return { x, y, width: Math.min(w, Math.ceil(Math.max(...points.map(p => p.x)) + margin)) - x,
		height: Math.min(h, Math.ceil(Math.max(...points.map(p => p.y)) + margin)) - y };
}
function ellipseGeometry(e: PixelEllipse, w: number, h: number): Geometry {
	return { type: "ellipse", center: normalized(e, w, h),
		axisA: normalized({ x: e.x + e.rx * Math.cos(e.angle), y: e.y + e.rx * Math.sin(e.angle) }, w, h),
		axisB: normalized({ x: e.x - e.ry * Math.sin(e.angle), y: e.y + e.ry * Math.cos(e.angle) }, w, h) };
}
export function roundGeometry(e: PixelEllipse, w: number, h: number): Geometry {
	const radius = (e.rx + e.ry) / 2;
	return e.ry / e.rx >= configuration.circleAxisRatio
		? { type: "circle", center: normalized(e, w, h), radiusX: radius / w, radiusY: radius / h }
		: ellipseGeometry(e, w, h);
}
function pixelEllipse(g: Geometry, w: number, h: number): PixelEllipse | null {
	if (g.type === "circle") return { ...point(g.center, w, h), rx: g.radiusX * w, ry: g.radiusY * h, angle: 0 };
	if (g.type !== "ellipse") return null;
	const c = point(g.center, w, h), a = point(g.axisA, w, h), b = point(g.axisB, w, h);
	return { ...c, rx: distance(c, a), ry: distance(c, b), angle: Math.atan2(a.y - c.y, a.x - c.x) };
}

function roundContours(cv: typeof CV, edges: CV.Mat, w: number, h: number, box: Region) {
	const roi = edges.roi(new cv.Rect(box.x, box.y, box.width, box.height));
	const contours = new cv.MatVector(), hierarchy = new cv.Mat();
	const candidates: Candidate[] = [];
	let contourCount = 0;
	try {
		cv.findContours(roi, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_NONE);
		contourCount = contours.size();
		for (let i = 0; i < Math.min(configuration.maxContours, contourCount); i++) {
			const contour = contours.get(i);
			try {
				if (contour.rows < 20) continue;
				const fit = cv.fitEllipse(contour);
				const swap = fit.size.width < fit.size.height;
				const e: PixelEllipse = { x: fit.center.x + box.x, y: fit.center.y + box.y,
					rx: Math.max(fit.size.width, fit.size.height) / 2,
					ry: Math.min(fit.size.width, fit.size.height) / 2,
					angle: (fit.angle + (swap ? 90 : 0)) * Math.PI / 180 };
				if (!Object.values(e).every(Number.isFinite) || e.ry < configuration.minRadius || e.rx > Math.min(w, h) * 0.45 || e.ry / e.rx < configuration.minEllipseAxisRatio) continue;
				const cos = Math.cos(e.angle), sin = Math.sin(e.angle);
				const extentX = Math.hypot(e.rx * cos, e.ry * sin), extentY = Math.hypot(e.rx * sin, e.ry * cos);
				if (e.x - extentX < 0 || e.x + extentX > w || e.y - extentY < 0 || e.y + extentY > h) continue;
				const bins = new Set<number>();
				let error = 0;
				for (let j = 0; j < contour.data32S.length; j += 2) {
					const x = (contour.data32S[j] ?? 0) + box.x - e.x;
					const y = (contour.data32S[j + 1] ?? 0) + box.y - e.y;
					const u = (x * cos + y * sin) / e.rx, v = (-x * sin + y * cos) / e.ry;
					error += Math.abs(Math.hypot(u, v) - 1);
					bins.add(Math.floor((Math.atan2(v, u) + Math.PI) / (2 * Math.PI) * 24) % 24);
				}
				const residual = error / contour.rows, coverage = bins.size / 24;
				if (residual > configuration.maxRadialResidual || coverage < configuration.minCoverage) continue;
				candidates.push({ geometry: roundGeometry(e, w, h), pixel: e, residual, coverage,
					quality: coverage * Math.max(0, 1 - residual * 5) });
			} finally { contour.delete(); }
		}
	} finally { hierarchy.delete(); contours.delete(); roi.delete(); }
	const unique: Candidate[] = [];
	for (const item of candidates.sort((a, b) => b.quality - a.quality)) {
		if (unique.some(other => distance(item.pixel, other.pixel) < Math.max(3, item.pixel.ry * 0.12) && Math.abs(Math.log(item.pixel.rx / other.pixel.rx)) < 0.15 && Math.abs(Math.log(item.pixel.ry / other.pixel.ry)) < 0.15)) continue;
		unique.push(item);
	}
	return { items: unique, contours: contourCount, truncatedContours: contourCount > configuration.maxContours };
}

function lineFit(detector: Detector, from: Point, to: Point, w: number, h: number) {
	const a = point(from, w, h), b = point(to, w, h), length = distance(a, b);
	if (length < 12) return null;
	const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
	const tolerance = Math.max(7, Math.min(18, length * 0.06));
	const box = region([a, b], tolerance + 2, w, h);
	if (box.width < 2 || box.height < 2) return null;
	const matches: { from: Point; to: Point; score: number }[] = [];
		for (const { from: p, to: q } of detector.lines(box, length)) {
			const l = distance(p, q);
			if (!l) continue;
			const direction = { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
			const alignment = Math.abs(dot(u, direction));
			if (alignment < Math.cos(12 * Math.PI / 180)) continue;
			const project = (r: Point) => {
				const t = dot({ x: r.x - p.x, y: r.y - p.y }, direction);
				return { x: p.x + direction.x * t, y: p.y + direction.y * t };
			};
			const start = project(a), end = project(b);
			const drift = (distance(start, a) + distance(end, b)) / 2;
			const along = [dot({ x: p.x - a.x, y: p.y - a.y }, u), dot({ x: q.x - a.x, y: q.y - a.y }, u)].sort((x, y) => x - y);
			const overlap = Math.max(0, Math.min(length, along[1] ?? 0) - Math.max(0, along[0] ?? 0)) / length;
			if (drift > tolerance || overlap < 0.45) continue;
			matches.push({ from: start, to: end, score: drift / tolerance + (1 - alignment) * 5 + (1 - overlap) * 0.3 });
		}
	matches.sort((a, b) => a.score - b.score);
	const best = matches[0];
	if (!best) return null;
	// Two comparably plausible parallel edges are safer left to the operator.
	if (matches.some(other => other.score - best.score < 0.12 && distance(other.from, best.from) > 3)) return null;
	const result = { from: normalized(best.from, w, h), to: normalized(best.to, w, h) };
	return inside(result.from) && inside(result.to) ? result : null;
}

function localFit(detector: Detector, draft: Geometry, w: number, h: number): { output: Geometry; reason: string } {
	if (draft.type === "line") {
		const fit = lineFit(detector, draft.from, draft.to, w, h);
		return fit ? { output: { ...draft, ...fit }, reason: "local-line" } : { output: draft, reason: "no-reliable-line" };
	}
	if (draft.type === "angle") {
		const armA = lineFit(detector, draft.vertex, draft.from, w, h);
		const armB = lineFit(detector, draft.vertex, draft.to, w, h);
		if (!armA || !armB) return { output: draft, reason: "unreliable-angle-arm" };
		const a = point(armA.from, w, h), b = point(armA.to, w, h), c = point(armB.from, w, h), d = point(armB.to, w, h);
		const ab = { x: b.x - a.x, y: b.y - a.y }, cd = { x: d.x - c.x, y: d.y - c.y };
		const determinant = ab.x * cd.y - ab.y * cd.x;
		if (Math.abs(determinant) < distance(a, b) * distance(c, d) * 0.15) return { output: draft, reason: "unstable-angle-intersection" };
		const t = ((c.x - a.x) * cd.y - (c.y - a.y) * cd.x) / determinant;
		const vertex = { x: a.x + t * ab.x, y: a.y + t * ab.y };
		if (distance(vertex, point(draft.vertex, w, h)) > 18 || !inside(normalized(vertex, w, h))) return { output: draft, reason: "angle-vertex-too-far" };
		return { output: { ...draft, vertex: normalized(vertex, w, h), from: armA.to, to: armB.to }, reason: "local-angle" };
	}
	const intent = pixelEllipse(draft, w, h);
	if (!intent) return { output: draft, reason: "manual-only-type" };
	const extent = Math.max(intent.rx, intent.ry) + 20;
	const box = region([{ x: intent.x - extent, y: intent.y - extent }, { x: intent.x + extent, y: intent.y + extent }], 0, w, h);
	if (box.width < 2 || box.height < 2 || intent.rx < 3 || intent.ry < 3) return { output: draft, reason: "invalid-local-intent" };
	const matches = detector.rounds(box).flatMap(candidate => {
		const e = candidate.pixel;
		if (draft.type === "circle" && e.ry / e.rx < configuration.circleAxisRatio) return [];
		const shift = distance(e, intent), size = Math.abs(Math.log(e.rx / intent.rx)) + Math.abs(Math.log(e.ry / intent.ry));
		const rotation = draft.type === "ellipse" && intent.ry / intent.rx < 0.9 ? 1 - Math.abs(Math.cos(e.angle - intent.angle)) : 0;
		if (shift > Math.max(10, intent.ry * 0.22) || size > 0.6 || rotation > 0.1) return [];
		return [{ candidate, score: shift / Math.max(10, intent.ry) + size + rotation * 2 + (1 - candidate.quality) * 0.2 }];
	}).sort((a, b) => a.score - b.score);
	const best = matches[0];
	if (!best) return { output: draft, reason: "no-reliable-round" };
	if (matches[1] && matches[1].score - best.score < 0.1) return { output: draft, reason: "ambiguous-round" };
	return { output: draft.type === "ellipse" ? ellipseGeometry(best.candidate.pixel, w, h) : best.candidate.geometry, reason: "local-round" };
}

function safeFit(detector: Detector, draft: Geometry, w: number, h: number) {
	validateAnnotation(draft, emptyMetadata(), w, h);
	const result = localFit(detector, draft, w, h);
	try { validateAnnotation(result.output, emptyMetadata(), w, h); return result; }
	catch { return { output: draft, reason: "output-outside-geometry-contract" }; }
}

// Offline EdgeDrawing comparison uses the same intent matcher as Canny/Hough.
// Global segments are internal features, never offered as line candidates.
export function fitDetected(detections: Detections, draft: Geometry, w: number, h: number) {
	const started = performance.now();
	const result = safeFit({ lines: () => detections.lines, rounds: () => detections.rounds }, draft, w, h);
	return { input: draft, ...result, changed: JSON.stringify(draft) !== JSON.stringify(result.output), milliseconds: performance.now() - started };
}

export function analyze(cv: typeof CV, rgba: Uint8Array, w: number, h: number, drafts: Geometry[] = [], cancelled: () => boolean = () => false, detectCandidates = true) {
	if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > configuration.maxPixels || rgba.length !== w * h * 4) throw Error("IMAGE_BUDGET");
	if (drafts.length > 32) throw Error("DRAFT_BUDGET");
	for (const draft of drafts) validateAnnotation(draft, emptyMetadata(), w, h);
	if (cancelled()) throw Error("CANCELLED");
	const started = performance.now();
	const src = cv.matFromArray(h, w, cv.CV_8UC4, rgba), gray = new cv.Mat(), blurred = new cv.Mat(), edges = new cv.Mat();
	try {
		cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
		cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 1.2, 1.2, cv.BORDER_DEFAULT);
		cv.Canny(blurred, edges, configuration.cannyLow, configuration.cannyHigh);
		const preprocessMs = performance.now() - started;
		if (cancelled()) throw Error("CANCELLED");
		const roundsStart = performance.now();
		const rounds = detectCandidates ? roundContours(cv, edges, w, h, { x: 0, y: 0, width: w, height: h }) : { items: [], contours: 0, truncatedContours: false };
		const candidateMs = performance.now() - roundsStart;
		const locals: LocalResult[] = [];
		const detector: Detector = {
			rounds: box => roundContours(cv, edges, w, h, box).items,
			lines: (box, length) => {
				const roi = edges.roi(new cv.Rect(box.x, box.y, box.width, box.height)), lines = new cv.Mat();
				try {
					cv.HoughLinesP(roi, lines, 1, Math.PI / 180, Math.max(12, Math.floor(length * 0.18)), length * 0.45, 8);
					return Array.from({ length: lines.rows }, (_, i) => {
						const v = lines.intPtr(i, 0);
						return { from: { x: (v[0] ?? 0) + box.x, y: (v[1] ?? 0) + box.y }, to: { x: (v[2] ?? 0) + box.x, y: (v[3] ?? 0) + box.y } };
					});
				} finally { lines.delete(); roi.delete(); }
			},
		};
		for (const input of drafts) {
			if (cancelled()) throw Error("CANCELLED");
			const start = performance.now(), snapshot = JSON.stringify(input);
			const result = safeFit(detector, input, w, h);
			if (JSON.stringify(input) !== snapshot) throw Error("INPUT_MUTATED");
			locals.push({ input, output: result.output, reason: result.reason, changed: JSON.stringify(input) !== JSON.stringify(result.output), milliseconds: performance.now() - start });
		}
		return { configuration: configuration.version, width: w, height: h, preprocessMs, candidateMs,
			candidates: rounds.items.slice(0, configuration.maxCandidates), candidateCountBeforeLimit: rounds.items.length,
			contours: rounds.contours, truncatedContours: rounds.truncatedContours, locals, totalMs: performance.now() - started };
	} finally { edges.delete(); blurred.delete(); gray.delete(); src.delete(); }
}
