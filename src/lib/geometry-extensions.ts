import type { Geometry, Point } from "./annotations";
const TAU = Math.PI * 2;
const normalize = (angle: number) => ((angle % TAU) + TAU) % TAU;
export const pixel = (p: Point, w: number, h: number): Point => ({
	x: p.x * w,
	y: p.y * h,
});
export const normalized = (p: Point, w: number, h: number): Point => ({
	x: p.x / w,
	y: p.y / h,
});
export function anchor(g: Geometry): Point {
	return g.type === "angle"
		? g.vertex
		: g.type === "arc" || g.type === "line"
			? g.from
			: g.type === "ellipse" || g.type === "circle"
				? g.center
				: g.at;
}
export function arcGeometry(
	g: Extract<Geometry, { type: "arc" }>,
	w: number,
	h: number,
) {
	const a = pixel(g.from, w, h),
		b = pixel(g.via, w, h),
		c = pixel(g.to, w, h);
	const ab = { x: b.x - a.x, y: b.y - a.y },
		ac = { x: c.x - a.x, y: c.y - a.y };
	const cross = ab.x * ac.y - ab.y * ac.x,
		chord = Math.max(
			Math.hypot(ab.x, ab.y),
			Math.hypot(ac.x, ac.y),
			Math.hypot(b.x - c.x, b.y - c.y),
		);
	if (
		!Number.isFinite(cross) ||
		chord < 0.5 ||
		Math.abs(cross) / chord < 0.5 ||
		Math.hypot(ac.x, ac.y) < 0.5
	)
		return null;
	const q = ab.x * ab.x + ab.y * ab.y,
		r = ac.x * ac.x + ac.y * ac.y;
	const center = {
		x: a.x + (ac.y * q - ab.y * r) / (2 * cross),
		y: a.y + (ab.x * r - ac.x * q) / (2 * cross),
	};
	const radius = Math.hypot(a.x - center.x, a.y - center.y),
		start = Math.atan2(a.y - center.y, a.x - center.x),
		end = Math.atan2(c.y - center.y, c.x - center.x),
		mid = Math.atan2(b.y - center.y, b.x - center.x);
	const positive = normalize(end - start),
		sweep = normalize(mid - start) < positive ? positive : positive - TAU;
	return { center, radius, start, sweep };
}
export function ellipseGeometry(
	g: Extract<Geometry, { type: "ellipse" }>,
	w: number,
	h: number,
) {
	const c = pixel(g.center, w, h),
		a = pixel(g.axisA, w, h),
		b = pixel(g.axisB, w, h);
	const u = { x: a.x - c.x, y: a.y - c.y },
		v = { x: b.x - c.x, y: b.y - c.y };
	return {
		center: c,
		u,
		v,
		rx: Math.hypot(u.x, u.y),
		ry: Math.hypot(v.x, v.y),
		rotation: Math.atan2(u.y, u.x),
	};
}
export function angleGeometry(
	g: Extract<Geometry, { type: "angle" }>,
	w: number,
	h: number,
) {
	const center = pixel(g.vertex, w, h),
		a = pixel(g.from, w, h),
		b = pixel(g.to, w, h);
	const start = Math.atan2(a.y - center.y, a.x - center.x),
		positive = normalize(Math.atan2(b.y - center.y, b.x - center.x) - start);
	const minor = positive <= Math.PI ? positive : positive - TAU,
		sweep = g.reflex ? (minor > 0 ? minor - TAU : minor + TAU) : minor;
	return {
		center,
		start,
		sweep,
		radius:
			Math.min(
				Math.hypot(a.x - center.x, a.y - center.y),
				Math.hypot(b.x - center.x, b.y - center.y),
			) * (g.arcScale ?? 0.35),
	};
}
type Bounds = { left: number; right: number; top: number; bottom: number };
export function extendedBounds(
	g: Geometry,
	w: number,
	h: number,
): Bounds | null {
	if (g.type === "ellipse") {
		const e = ellipseGeometry(g, w, h),
			dx = Math.hypot(e.u.x, e.v.x),
			dy = Math.hypot(e.u.y, e.v.y);
		return {
			left: (e.center.x - dx) / w,
			right: (e.center.x + dx) / w,
			top: (e.center.y - dy) / h,
			bottom: (e.center.y + dy) / h,
		};
	}
	let ps: Point[];
	if (g.type === "angle") ps = [g.vertex, g.from, g.to];
	else if (g.type === "arc") {
		const arc = arcGeometry(g, w, h);
		if (!arc) return { left: -1, right: 2, top: -1, bottom: 2 };
		ps = [g.from, g.via, g.to];
		for (const t of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
			const along =
				arc.sweep > 0 ? normalize(t - arc.start) : normalize(arc.start - t);
			if (along <= Math.abs(arc.sweep) + 1e-10)
				ps.push(
					normalized(
						{
							x: arc.center.x + arc.radius * Math.cos(t),
							y: arc.center.y + arc.radius * Math.sin(t),
						},
						w,
						h,
					),
				);
		}
	} else return null;
	return {
		left: Math.min(...ps.map((p) => p.x)),
		right: Math.max(...ps.map((p) => p.x)),
		top: Math.min(...ps.map((p) => p.y)),
		bottom: Math.max(...ps.map((p) => p.y)),
	};
}
export function validExtendedGeometry(g: Geometry, w: number, h: number) {
	if (g.type === "angle") {
		const a = pixel(g.from, w, h),
			b = pixel(g.to, w, h),
			c = pixel(g.vertex, w, h),
			d = angleGeometry(g, w, h);
		if (
			Math.hypot(a.x - c.x, a.y - c.y) < 0.5 ||
			Math.hypot(b.x - c.x, b.y - c.y) < 0.5 ||
			Math.abs(d.sweep) < 0.001 ||
			Math.abs(d.sweep) > TAU - 0.001
		)
			return false;
	}
	if (g.type === "ellipse") {
		const e = ellipseGeometry(g, w, h);
		if (
			e.rx < 0.5 ||
			e.ry < 0.5 ||
			e.rx + 1e-7 < e.ry ||
			Math.abs(e.u.x * e.v.x + e.u.y * e.v.y) > 1e-7 * e.rx * e.ry
		)
			return false;
	}
	const b = extendedBounds(g, w, h);
	return (
		!b ||
		(b.left >= -1e-9 &&
			b.right <= 1 + 1e-9 &&
			b.top >= -1e-9 &&
			b.bottom <= 1 + 1e-9)
	);
}
export function makeEllipse(
	from: Point,
	to: Point,
	w: number,
	h: number,
): Extract<Geometry, { type: "ellipse" }> {
	const c = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
		ux = ((to.x - from.x) * w) / 2,
		uy = ((to.y - from.y) * h) / 2,
		r = Math.hypot(ux, uy),
		nx = r ? -uy / r : 0,
		ny = r ? ux / r : 1;
	// The drag endpoints are the complete first axis. Keep the initial width in-image.
	const ry = Math.min(
		r / 2,
		nx
			? Math.sqrt(Math.max(0, (Math.min(c.x, 1 - c.x) * w) ** 2 - ux ** 2)) /
					Math.abs(nx)
			: Infinity,
		ny
			? Math.sqrt(Math.max(0, (Math.min(c.y, 1 - c.y) * h) ** 2 - uy ** 2)) /
					Math.abs(ny)
			: Infinity,
	);
	return {
		type: "ellipse",
		center: c,
		axisA: { ...to },
		axisB: {
			x: c.x + (nx * ry) / w,
			y: c.y + (ny * ry) / h,
		},
	};
}
export function editEllipse(
	g: Extract<Geometry, { type: "ellipse" }>,
	key: string,
	end: Point,
	w: number,
	h: number,
): Geometry {
	const e = ellipseGeometry(g, w, h),
		p = pixel(end, w, h),
		dx = p.x - e.center.x,
		dy = p.y - e.center.y;
	let rotation = e.rotation,
		rx = e.rx,
		ry = e.ry;
	if (key === "rotate") rotation = Math.atan2(dy, dx) + Math.PI / 2;
	else if (key === "axisA")
		rx = Math.abs(dx * Math.cos(rotation) + dy * Math.sin(rotation));
	else ry = Math.abs(-dx * Math.sin(rotation) + dy * Math.cos(rotation));
	// Storage keeps axisA as the major axis; the user's first axis need not stay longest.
	if (ry > rx) {
		[rx, ry] = [ry, rx];
		rotation += Math.PI / 2;
	}
	return {
		...g,
		axisA: normalized(
			{
				x: e.center.x + rx * Math.cos(rotation),
				y: e.center.y + rx * Math.sin(rotation),
			},
			w,
			h,
		),
		axisB: normalized(
			{
				x: e.center.x - ry * Math.sin(rotation),
				y: e.center.y + ry * Math.cos(rotation),
			},
			w,
			h,
		),
	};
}
export function geometryTarget(g: Geometry): unknown {
	if (g.type !== "angle") return g;
	const { arcScale: _display, ...target } = g;
	return target;
}
