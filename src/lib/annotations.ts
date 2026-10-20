import { z } from "zod";
import { AppError } from "./policy";
export type Point = { x: number; y: number };
const point = z
	.object({
		x: z.number().finite().min(0).max(1),
		y: z.number().finite().min(0).max(1),
	})
	.strict();
export const geometrySchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("line"), from: point, to: point }).strict(),
	z
		.object({
			type: z.literal("circle"),
			center: point,
			radiusX: z.number().finite().positive().max(1),
			radiusY: z.number().finite().positive().max(1),
		})
		.strict(),
	z.object({ type: z.literal("point"), at: point }).strict(),
	z
		.object({
			type: z.literal("text"),
			at: point,
			text: z.string().trim().min(1).max(500),
		})
		.strict(),
]);
const decimal = z
	.string()
	.max(24)
	.refine(
		(v) =>
			v === "" ||
			(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(v) && Number(v) > 0),
	);
export const metadataSchema = z
	.object({
		name: z.string().max(120),
		dimension: decimal,
		unit: z.enum(["mm", "cm", "m", "in"]),
		source: z.literal("human"),
		circleMeasure: z.enum(["diameter", "radius"]),
		holeDepth: decimal,
		holeType: z.enum([
			"",
			"through",
			"blind",
			"threaded",
			"counterbore",
			"countersink",
			"other",
		]),
		thread: z.string().max(80),
		notes: z.string().max(2000),
		measurementMode: z.enum(["auto", "required", "none"]).optional(),
		requireHoleDepth: z.boolean().optional(),
		measurementMethod: z.enum(["outside", "inside", "depth", "other", "unspecified"]).optional(),
		measurementInstructions: z.string().max(2000).optional(),
	})
	.strict();
export type Geometry = z.infer<typeof geometrySchema>;
export type EngineeringMetadata = z.infer<typeof metadataSchema>;
export type AnnotationDraft = {
	/** Read-only server summary, never part of an annotation write. */
	collaboration?: { pending: number; submitted: number };
	id: string;
	geometry: Geometry;
	metadata: EngineeringMetadata;
};
export type Annotation = AnnotationDraft & {
	revision: number;
	deleted: boolean;
	createdAt: string;
	updatedAt: string;
};
export type CanonicalImage = {
	id: string;
	width: number;
	height: number;
	imageHash: string;
	normalizationVersion: 1;
};
export type AnnotationDocument = { image: CanonicalImage; items: Annotation[] };
export const emptyMetadata = (): EngineeringMetadata => ({
	name: "",
	dimension: "",
	unit: "mm",
	source: "human",
	circleMeasure: "diameter",
	holeDepth: "",
	holeType: "",
	thread: "",
	notes: "",
});
const fields = {
	geometry: geometrySchema,
	metadata: metadataSchema,
	imageHash: z.string().regex(/^[a-f0-9]{64}$/),
};
export const createAnnotationSchema = z
	.object({ id: z.uuid(), fileId: z.uuid(), ...fields })
	.strict();
export const updateAnnotationSchema = z.object(fields).strict();
export const fileIssueSchema = z
	.object({
		fileId: z.uuid(),
		title: z.string().trim().min(1).max(120),
		description: z.string().max(4000),
	})
	.strict();
export type FileIssue = {
	id: string;
	fileId: string;
	kind: "comment";
	title: string;
	description: string;
	createdAt: string;
};
export function validateAnnotation(
	geometry: Geometry,
	metadata: EngineeringMetadata,
	width: number,
	height: number,
) {
	if (!geometrySchema.safeParse(geometry).success)
		throw new AppError("INVALID_GEOMETRY", 422);
	if (!metadataSchema.safeParse(metadata).success)
		throw new AppError("INVALID_ENGINEERING_FIELDS", 422);
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width <= 0 ||
		height <= 0
	)
		throw new AppError("IMAGE_NOT_READY", 409);
	if (
		geometry.type === "line" &&
		Math.hypot(
			(geometry.to.x - geometry.from.x) * width,
			(geometry.to.y - geometry.from.y) * height,
		) < 0.5
	)
		throw new AppError("INVALID_GEOMETRY", 422);
	if (geometry.type === "circle") {
		const { center: c, radiusX: rx, radiusY: ry } = geometry;
		if (
			rx * width < 0.5 ||
			Math.abs(rx * width - ry * height) > 0.5 ||
			c.x - rx < 0 ||
			c.x + rx > 1 ||
			c.y - ry < 0 ||
			c.y + ry > 1
		)
			throw new AppError("INVALID_GEOMETRY", 422);
	} else if (metadata.holeDepth || metadata.holeType || metadata.thread)
		throw new AppError("INVALID_ENGINEERING_FIELDS", 422);
	if (
		(geometry.type === "text" || (geometry.type === "point" && metadata.measurementMode !== "required")) &&
		metadata.dimension
	)
		throw new AppError("INVALID_ENGINEERING_FIELDS", 422);
}
export type View = { x: number; y: number; scale: number };
export const toScreen = (p: Point, w: number, h: number, v: View): Point => ({
	x: v.x + p.x * w * v.scale,
	y: v.y + p.y * h * v.scale,
});
export const fromScreen = (p: Point, w: number, h: number, v: View): Point => ({
	x: (p.x - v.x) / (w * v.scale),
	y: (p.y - v.y) / (h * v.scale),
});
export function fitView(
	w: number,
	h: number,
	viewportW: number,
	viewportH: number,
): View {
	const scale = Math.max(
		0.001,
		Math.min((viewportW - 32) / w, (viewportH - 32) / h),
	);
	return {
		x: (viewportW - w * scale) / 2,
		y: (viewportH - h * scale) / 2,
		scale,
	};
}
export function zoomView(view: View, anchor: Point, scale: number): View {
	const next = Math.max(0.005, Math.min(32, scale));
	const ratio = next / view.scale;
	return {
		x: anchor.x - (anchor.x - view.x) * ratio,
		y: anchor.y - (anchor.y - view.y) * ratio,
		scale: next,
	};
}
export const inside = (p: Point) =>
	Number.isFinite(p.x) &&
	Number.isFinite(p.y) &&
	p.x >= 0 &&
	p.x <= 1 &&
	p.y >= 0 &&
	p.y <= 1;
export function bounds(g: Geometry) {
	if (g.type === "circle")
		return {
			left: g.center.x - g.radiusX,
			right: g.center.x + g.radiusX,
			top: g.center.y - g.radiusY,
			bottom: g.center.y + g.radiusY,
		};
	const ps = g.type === "line" ? [g.from, g.to] : [g.at];
	return {
		left: Math.min(...ps.map((p) => p.x)),
		right: Math.max(...ps.map((p) => p.x)),
		top: Math.min(...ps.map((p) => p.y)),
		bottom: Math.max(...ps.map((p) => p.y)),
	};
}
export function moveGeometry(g: Geometry, dx: number, dy: number): Geometry {
	const b = bounds(g),
		x = Math.max(-b.left, Math.min(1 - b.right, dx)),
		y = Math.max(-b.top, Math.min(1 - b.bottom, dy));
	const move = (p: Point) => ({ x: p.x + x, y: p.y + y });
	if (g.type === "line") return { ...g, from: move(g.from), to: move(g.to) };
	if (g.type === "circle") return { ...g, center: move(g.center) };
	return { ...g, at: move(g.at) };
}
export function makeCircle(
	center: Point,
	edge: Point,
	w: number,
	h: number,
): Geometry {
	const radius = Math.min(
		Math.hypot((edge.x - center.x) * w, (edge.y - center.y) * h),
		center.x * w,
		(1 - center.x) * w,
		center.y * h,
		(1 - center.y) * h,
	);
	return { type: "circle", center, radiusX: radius / w, radiusY: radius / h };
}
export function sameContent(a: unknown, b: unknown): boolean {
	const stable = (v: unknown): unknown =>
		Array.isArray(v)
			? v.map(stable)
			: v !== null && typeof v === "object"
				? Object.fromEntries(
						Object.entries(v)
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([k, val]) => [k, stable(val)]),
					)
				: v;
	return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
export const typeLabel = (g: Geometry) =>
	({ line: "线段", circle: "圆 / 孔位", point: "点位", text: "文字备注" })[
		g.type
	];
