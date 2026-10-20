import { bounds, type Geometry } from "../lib/annotations";

// Match object-fit: contain, including letterboxing around portrait images.
export function annotationHitRegion(
	geometry: Geometry,
	image: { width: number; height: number },
	box: { width: number; height: number },
) {
	const scale = Math.min(box.width / image.width, box.height / image.height);
	const offsetX = (box.width - image.width * scale) / 2;
	const offsetY = (box.height - image.height * scale) / 2;
	if (["angle", "arc", "ellipse"].includes(geometry.type)) {
		const b = bounds(geometry, image.width, image.height);
		return {
			left: offsetX + ((b.left + b.right) * image.width * scale) / 2,
			top: offsetY + ((b.top + b.bottom) * image.height * scale) / 2,
			width: Math.max(44, (b.right - b.left) * image.width * scale),
			height: Math.max(44, (b.bottom - b.top) * image.height * scale),
			transform: "translate(-50%, -50%)",
		};
	}
	const anchor =
		geometry.type === "line"
			? {
					x: (geometry.from.x + geometry.to.x) / 2,
					y: (geometry.from.y + geometry.to.y) / 2,
				}
			: geometry.type === "circle"
				? geometry.center
				: "at" in geometry
					? geometry.at
					: { x: 0, y: 0 };
	const width =
		geometry.type === "line"
			? Math.hypot(
					(geometry.to.x - geometry.from.x) * image.width * scale,
					(geometry.to.y - geometry.from.y) * image.height * scale,
				)
			: geometry.type === "circle"
				? geometry.radiusX * image.width * scale * 2
				: 44;
	const height =
		geometry.type === "circle"
			? geometry.radiusY * image.height * scale * 2
			: 44;
	const angle =
		geometry.type === "line"
			? (Math.atan2(
					(geometry.to.y - geometry.from.y) * image.height,
					(geometry.to.x - geometry.from.x) * image.width,
				) *
					180) /
				Math.PI
			: 0;
	return {
		left: offsetX + anchor.x * image.width * scale,
		top: offsetY + anchor.y * image.height * scale,
		width: Math.max(44, width),
		height: Math.max(44, height),
		transform: `translate(-50%, -50%) rotate(${angle}deg)`,
	};
}
