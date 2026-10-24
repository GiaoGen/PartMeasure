import type { Geometry } from "../annotations";

export const CV_WORKER_URL = "/cv/worker-v1.js";
export const CV_VENDOR_URL = "/cv/opencv-4.12.0-bd0c3e644804.js";
export const CV_MAX_SIDE = 1024;
export const CV_MAX_CANDIDATES = 12;
// Emscripten embind uses new Function. Only the isolated worker response gets
// this policy; the document keeps its nonce-based script policy unchanged.
export const CV_WORKER_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'";
export type CvRequest = { id: number; rgba: ArrayBuffer; width: number; height: number; drafts: Geometry[]; candidates: boolean };
export type CvResult = {
	candidates: Geometry[];
	locals: { output: Geometry; changed: boolean; reason: string }[];
};
export type CvResponse = { kind: "ready" } | { kind: "result"; id: number; result: CvResult } | { kind: "error"; id?: number; message: string };

export type CvRaster = { width: number; height: number; scale: number; canonicalWidth: number; canonicalHeight: number };
export function cvRaster(width: number, height: number): CvRaster {
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw Error("CV_IMAGE_SIZE");
	const scale = Math.min(1, CV_MAX_SIDE / Math.max(width, height));
	return { width: Math.min(CV_MAX_SIDE, Math.ceil(width * scale)), height: Math.min(CV_MAX_SIDE, Math.ceil(height * scale)), scale, canonicalWidth: width, canonicalHeight: height };
}
/** Uniform image scale with <1px padding preserves circles and orthogonal ellipse
 * axes. Stretching to rounded integer dimensions would break that contract. */
export function cvGeometry(g: Geometry, raster: CvRaster, direction: "to-raster" | "to-canonical"): Geometry {
	const fx = raster.canonicalWidth * raster.scale / raster.width, fy = raster.canonicalHeight * raster.scale / raster.height;
	const x = direction === "to-raster" ? fx : 1 / fx, y = direction === "to-raster" ? fy : 1 / fy;
	const p = (q: { x: number; y: number }) => ({ x: q.x * x, y: q.y * y });
	if (g.type === "line") return { ...g, from: p(g.from), to: p(g.to) };
	if (g.type === "angle") return { ...g, from: p(g.from), vertex: p(g.vertex), to: p(g.to) };
	if (g.type === "circle") return { ...g, center: p(g.center), radiusX: g.radiusX * x, radiusY: g.radiusY * y };
	if (g.type === "ellipse") return { ...g, center: p(g.center), axisA: p(g.axisA), axisB: p(g.axisB) };
	return g;
}
