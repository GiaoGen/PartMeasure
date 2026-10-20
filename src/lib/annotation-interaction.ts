import {
	makeCircle,
	moveGeometry,
	type Geometry,
	type Point,
} from "./annotations";
import { angleGeometry, editEllipse, pixel } from "./geometry-extensions";

export function threePointGeometry(
	tool: "angle" | "arc",
	[a, b, c]: readonly [Point, Point, Point],
): Geometry {
	return tool === "angle"
		? {
				type: "angle",
				from: a,
				vertex: b,
				to: c,
				reflex: false,
				arcScale: 0.35,
			}
		: { type: "arc", from: a, via: b, to: c };
}

// Every preview is derived from the drag-start geometry, never the preceding frame.
export function dragHandleGeometry(
	g: Geometry,
	key: string,
	end: Point,
	w: number,
	h: number,
): Geometry {
	if (g.type === "line")
		return { ...g, ...(key === "from" ? { from: end } : { to: end }) };
	if (g.type === "circle") return makeCircle(g.center, end, w, h);
	if (g.type === "arc") return { ...g, [key]: end };
	if (g.type === "angle") {
		if (key !== "arcScale") return { ...g, [key]: end };
		const v = angleGeometry(g, w, h),
			q = pixel(end, w, h);
		return {
			...g,
			arcScale: Math.max(
				0.1,
				Math.min(
					0.85,
					((g.arcScale ?? 0.35) *
						Math.hypot(q.x - v.center.x, q.y - v.center.y)) /
						Math.max(v.radius, 0.001),
				),
			),
		};
	}
	if (g.type === "ellipse")
		return key === "center"
			? moveGeometry(g, end.x - g.center.x, end.y - g.center.y, w, h)
			: editEllipse(g, key, end, w, h);
	return g;
}
