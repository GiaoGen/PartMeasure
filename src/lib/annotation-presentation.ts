import type { AnnotationDraft, Geometry, Point } from "./annotations";
import {
	anchor,
	angleGeometry,
	arcGeometry,
	ellipseGeometry,
	pixel,
} from "./geometry-extensions";
import {
	displayUnit,
	measurementFieldLabel,
	requiredMeasurements,
	type MeasurementField,
} from "./annotation-collaboration";
const p = (point: Point) => `${point.x} ${point.y}`;
const segment = (a: Point, b: Point) => `M${p(a)}L${p(b)}`;
const polar = (c: Point, r: number, t: number): Point => ({
	x: c.x + r * Math.cos(t),
	y: c.y + r * Math.sin(t),
});
function arcPath(c: Point, r: number, start: number, sweep: number) {
	const a = polar(c, r, start),
		b = polar(c, r, start + sweep);
	return `M${p(a)}A${r} ${r} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${p(b)}`;
}
export function dimensionPath(a: Point, b: Point, scale: number) {
	const length = Math.hypot(b.x - a.x, b.y - a.y);
	if (length < 1e-9) return "";
	const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length },
		n = { x: -u.y, y: u.x },
		tick = 6 / scale,
		arrow = (length < 40 / scale ? -6 : 6) / scale,
		half = 2.5 / scale;
	const cap = (q: Point) =>
		segment(
			{ x: q.x - n.x * tick, y: q.y - n.y * tick },
			{ x: q.x + n.x * tick, y: q.y + n.y * tick },
		);
	const head = (q: Point, d: number) =>
		`${segment({ x: q.x + u.x * arrow * d + n.x * half, y: q.y + u.y * arrow * d + n.y * half }, q)}L${q.x + u.x * arrow * d - n.x * half} ${q.y + u.y * arrow * d - n.y * half}`;
	return [segment(a, b), cap(a), cap(b), head(a, 1), head(b, -1)].join(" ");
}
export function geometryPaths(
	g: Geometry,
	w: number,
	h: number,
	scale = 1,
	axes = false,
): string[] {
	if (g.type === "line")
		return [dimensionPath(pixel(g.from, w, h), pixel(g.to, w, h), scale)];
	if (g.type === "point" || g.type === "text") {
		const c = pixel(g.at, w, h),
			r = 5 / scale;
		return [
			`M${c.x - r} ${c.y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`,
		];
	}
	if (g.type === "circle") {
		const c = pixel(g.center, w, h),
			r = g.radiusX * w;
		if (r < 0.5) return [];
		return [
			`M${c.x - r} ${c.y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`,
		];
	}
	if (g.type === "arc") {
		const arc = arcGeometry(g, w, h);
		if (!arc) return [];
		return [arcPath(arc.center, arc.radius, arc.start, arc.sweep)];
	}
	if (g.type === "angle") {
		const a = angleGeometry(g, w, h);
		return [
			segment(pixel(g.from, w, h), a.center) +
				segment(a.center, pixel(g.to, w, h)),
			...(a.radius >= 0.5 &&
			Math.abs(a.sweep) >= 0.001 &&
			Math.abs(a.sweep) < Math.PI * 2 - 0.001
				? [arcPath(a.center, a.radius, a.start, a.sweep)]
				: []),
		];
	}
	const e = ellipseGeometry(g, w, h),
		a = pixel(g.axisA, w, h),
		b = { x: 2 * e.center.x - a.x, y: 2 * e.center.y - a.y };
	if (e.rx < 0.5 || e.ry < 0.5) return [];
	const paths = [
		`M${p(a)}A${e.rx} ${e.ry} ${(e.rotation * 180) / Math.PI} 1 1 ${p(b)}A${e.rx} ${e.ry} ${(e.rotation * 180) / Math.PI} 1 1 ${p(a)}`,
	];
	if (axes) {
		paths.push(segment(a, b));
		const v = pixel(g.axisB, w, h);
		paths.push(
			segment(v, { x: 2 * e.center.x - v.x, y: 2 * e.center.y - v.y }),
		);
	}
	return paths;
}
export function measurementText(
	item: AnnotationDraft,
	field: MeasurementField,
) {
	const reply = item.collaboration?.values?.[field];
	const value = item.metadata[field] || reply?.value,
		g = item.geometry;
	if (!value) return `${measurementFieldLabel(item, field)}待补`;
	const prefix =
		field === "dimension"
			? g.type === "ellipse"
				? "Ø"
				: g.type === "circle"
					? item.metadata.circleMeasure === "radius"
						? "R"
						: "Ø"
					: g.type === "arc"
						? "R"
						: ""
			: field === "majorRadius"
				? "a"
				: "";
	return `${prefix}${value}${field === "angleValue" ? "°" : ` ${item.metadata[field] ? item.metadata.unit : reply?.unit}`}`;
}
export function annotationText(item: AnnotationDraft) {
	const required = requiredMeasurements(item);
	const fields = requiredMeasurements({
		...item,
		metadata: {
			...item.metadata,
			measurementMode:
				item.geometry.type === "point" ? item.metadata.measurementMode : "auto",
		},
	});
	return fields
		.filter(
			(f) =>
				!!item.metadata[f] ||
				!!item.collaboration?.values?.[f] ||
				required.includes(f),
		)
		.map(
			(f) =>
				`${fields.length > 1 ? `${measurementFieldLabel(item, f)}：` : ""}${measurementText(item, f)}`,
		)
		.join(" · ");
}
// Photo overlays contain measured values only; details stay in the properties panel.
export function photoDimensionText(item: AnnotationDraft) {
	return requiredMeasurements({
		...item,
		metadata: {
			...item.metadata,
			measurementMode:
				item.geometry.type === "point" ? item.metadata.measurementMode : "auto",
		},
	})
		.filter(
			(field) =>
				!!item.metadata[field] || !!item.collaboration?.values?.[field],
		)
		.map(
			(field) =>
				`${field === "holeDepth" ? "h" : field === "arcLength" ? "L" : ""}${measurementText(item, field)}`,
		)
		.join(" · ");
}
export function annotationColor(item: AnnotationDraft) {
	if (item.collaboration?.remeasure) return "#eab308";
	if (item.collaboration?.pending) return "#dc2626";
	if (item.collaboration) return "#16a34a";
	return requiredMeasurements(item).some((field) => !item.metadata[field])
		? "#dc2626"
		: "#16a34a";
}
export function labelPosition(
	g: Geometry,
	w: number,
	h: number,
	scale: number,
): Point {
	if (g.type === "line") {
		const a = pixel(g.from, w, h),
			b = pixel(g.to, w, h),
			length = Math.hypot(b.x - a.x, b.y - a.y);
		let nx = -(b.y - a.y) / Math.max(length, 1e-9),
			ny = (b.x - a.x) / Math.max(length, 1e-9);
		if (ny > 0) {
			nx = -nx;
			ny = -ny;
		}
		return {
			x: (a.x + b.x) / 2 + (nx * (length < 40 / scale ? 26 : 16)) / scale,
			y: (a.y + b.y) / 2 + (ny * (length < 40 / scale ? 26 : 16)) / scale,
		};
	}
	if (g.type === "angle") {
		const a = angleGeometry(g, w, h);
		return polar(a.center, a.radius + 20 / scale, a.start + a.sweep / 2);
	}
	if (g.type === "arc") {
		const a = arcGeometry(g, w, h);
		if (a) return polar(a.center, a.radius + 18 / scale, a.start + a.sweep / 2);
	}
	const at = pixel(anchor(g), w, h);
	return { x: at.x, y: at.y - 22 / scale };
}
export function fieldUnits(field: MeasurementField, lengthUnit: string) {
	return field === "angleValue" ? displayUnit("deg") : lengthUnit;
}
