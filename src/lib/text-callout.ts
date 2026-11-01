import type { Geometry, Point } from "./annotations";

export type TextGeometry = Extract<Geometry, { type: "text" }>;
export const calloutColor = "#dc2626";

/** Legacy text keeps its original target; its missing tail is display-only. */
export function textTail(g: TextGeometry): Point {
	return g.labelAt ?? {
		x: g.at.x > 0.5 ? Math.max(0, g.at.x - 0.2) : Math.min(1, g.at.x + 0.2),
		y: Math.max(0, g.at.y - 0.12),
	};
}

export function calloutPath(g: TextGeometry, w: number, h: number, scale: number) {
	const tail = textTail(g), ax = tail.x * w, ay = tail.y * h,
		bx = g.at.x * w, by = g.at.y * h,
		length = Math.hypot(bx - ax, by - ay);
	if (length < 0.5) return "";
	const ux = (bx - ax) / length, uy = (by - ay) / length,
		head = Math.min(9 / scale, length * 0.4), half = head * 0.45;
	return `M${ax} ${ay}L${bx} ${by} M${bx - ux * head - uy * half} ${by - uy * head + ux * half}L${bx} ${by}L${bx - ux * head + uy * half} ${by - uy * head - ux * half}`;
}

function characterWidth(character: string) {
	if (character === "\t") return 4;
	if (character === " ") return 0.4;
	if (/[ilI1.,:;'!|]/u.test(character)) return 0.35;
	if (/[MW@#%]/u.test(character)) return 1;
	if (/[A-Z]/u.test(character)) return 0.75;
	return /[a-z0-9]/u.test(character) ? 0.65 : 1;
}
function wrap(text: string, columns: number) {
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		let line = "", used = 0;
		for (const character of Array.from(paragraph)) {
			const width = characterWidth(character);
			if (line && used + width > columns) { lines.push(line); line = ""; used = 0; }
			line += character; used += width;
		}
		lines.push(line);
	}
	return lines;
}

/** Canvas, SVG and exports share wrapping and image-edge placement. */
export function calloutLayout(g: TextGeometry, w: number, h: number, scale: number) {
	const tail = textTail(g), maxWidth = Math.min(w, 220 / scale);
	let fontSize = Math.min(16 / scale, maxWidth / 2), lines = wrap(g.text, maxWidth / fontSize);
	for (let i = 0; i < 3 && lines.length * fontSize * 1.3 > h; i++) {
		fontSize = Math.min(fontSize, h / (lines.length * 1.3));
		lines = wrap(g.text, maxWidth / fontSize);
	}
	const width = Math.min(maxWidth, Math.max(fontSize, ...lines.map(line => Array.from(line).reduce((sum, character) => sum + characterWidth(character), 0) * fontSize)));
	const lineHeight = fontSize * 1.3, height = lines.length * lineHeight;
	const x = g.at.x >= tail.x ? tail.x * w - width - 8 / scale : tail.x * w + 8 / scale;
	return {
		x: Math.max(0, Math.min(w - width, x)),
		y: Math.max(0, Math.min(h - height, tail.y * h - height / 2)),
		width, height, fontSize, lineHeight, lines,
	};
}

export function annotationLabel(item: { geometry: Geometry; metadata: { name: string } }) {
	return item.geometry.type === "text"
		? item.geometry.text.split("\n")[0]?.slice(0, 60) || "箭头文字"
		: item.metadata.name;
}
