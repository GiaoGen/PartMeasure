import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp, { type OverlayOptions } from "sharp";
import type { Candidate } from "./core";

const directory = new URL("../../tmp/p1-03/", import.meta.url);
const destination = new URL("review/", directory);
const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8")) as { items: { id: string; category: string; canonicalPath: string }[] };
await mkdir(destination, { recursive: true });
const categories = [...new Set(manifest.items.map(s => s.category))];
for (const category of categories) {
	const selected = manifest.items.filter(s => s.category === category);
	for (let page = 0; page < 2; page++) {
		const layers: OverlayOptions[] = [];
		for (const [row, sample] of selected.slice(page * 3, page * 3 + 3).entries()) {
			for (const [col, source] of [sample.canonicalPath, `results/overlays/baseline-${sample.id}.png`, `results/overlays/edge-${sample.id}.png`].entries()) {
				const picture = await sharp(fileURLToPath(new URL(source, directory))).resize(384, 384).png().toBuffer();
				layers.push({ input: picture, left: col * 384, top: row * 412 });
				const label = `${sample.id} / ${["original", "baseline", "edge"][col]}`;
				layers.push({ input: Buffer.from(`<svg width="384" height="28"><rect width="384" height="28" fill="white"/><text x="5" y="19" font-size="16" font-family="Arial">${label}</text></svg>`), left: col * 384, top: row * 412 + 384 });
			}
		}
		await sharp({ create: { width: 1152, height: 1236, channels: 3, background: "white" } }).composite(layers).png().toFile(fileURLToPath(new URL(`${category}-${page + 1}.png`, destination)));
	}
}
// Magnified original/overlay pairs for small or ambiguous candidates. Each
// numbered crop uses the displayed candidate order, including the 12-item cap.
const crops: { id: string; engine: string; index: number; bytes: Buffer }[] = [];
const snapshot = [];
for (const sample of manifest.items) for (const engine of ["baseline", "edge"]) {
	const bytes = await readFile(new URL(engine === "baseline" ? `results/${sample.id}.json` : `edge-drawing/view-${sample.id}.json`, directory));
	const result = JSON.parse(bytes.toString()) as { width: number; height: number; candidates: Candidate[] };
	snapshot.push({ imageId: sample.id, engine, resultSha256: createHash("sha256").update(bytes).digest("hex"), count: result.candidates.length });
	for (const [i, c] of result.candidates.entries()) {
		const cos = Math.cos(c.pixel.angle), sin = Math.sin(c.pixel.angle);
		const ex = Math.hypot(c.pixel.rx * cos, c.pixel.ry * sin), ey = Math.hypot(c.pixel.rx * sin, c.pixel.ry * cos);
		const left = Math.max(0, Math.floor(c.pixel.x - ex - 18)), top = Math.max(0, Math.floor(c.pixel.y - ey - 18));
		const width = Math.min(result.width - left, Math.ceil(ex * 2 + 36)), height = Math.min(result.height - top, Math.ceil(ey * 2 + 36));
		const layers: OverlayOptions[] = [];
		const g = c.geometry;
		let markup = "";
		if (g.type === "circle") markup = `<ellipse cx="${g.center.x * result.width}" cy="${g.center.y * result.height}" rx="${g.radiusX * result.width}" ry="${g.radiusY * result.height}"/>`;
		if (g.type === "ellipse") {
			const x = g.center.x * result.width, y = g.center.y * result.height;
			const a = { x: g.axisA.x * result.width - x, y: g.axisA.y * result.height - y }, b = { x: g.axisB.x * result.width - x, y: g.axisB.y * result.height - y };
			markup = `<ellipse cx="${x}" cy="${y}" rx="${Math.hypot(a.x, a.y)}" ry="${Math.hypot(b.x, b.y)}" transform="rotate(${Math.atan2(a.y, a.x) * 180 / Math.PI} ${x} ${y})"/>`;
		}
		const original = await readFile(new URL(sample.canonicalPath, directory));
		const marked = await sharp(original).composite([{ input: Buffer.from(`<svg width="${result.width}" height="${result.height}"><g fill="none" stroke="#ff2c74" stroke-width="1.5">${markup}</g></svg>`) }]).png().toBuffer();
		for (const [j, bytes] of [original, marked].entries()) {
			const cropped = await sharp(bytes).extract({ left, top, width, height }).resize(180, 180, { fit: "contain", background: "white" }).png().toBuffer();
			layers.push({ input: cropped, left: j * 180, top: 0 });
		}
		layers.push({ input: Buffer.from(`<svg width="360" height="28"><rect width="360" height="28" fill="white"/><text x="4" y="18" font-size="13" font-family="Arial">${sample.id} ${engine} #${i + 1} ${c.geometry.type}</text></svg>`), left: 0, top: 180 });
		crops.push({ id: sample.id, engine, index: i + 1, bytes: await sharp({ create: { width: 360, height: 208, channels: 3, background: "white" } }).composite(layers).png().toBuffer() });
	}
}
for (let page = 0; page < Math.ceil(crops.length / 12); page++) {
	const layers = crops.slice(page * 12, page * 12 + 12).map((c, i) => ({ input: c.bytes, left: i % 3 * 360, top: Math.floor(i / 3) * 208 }));
	await sharp({ create: { width: 1080, height: 832, channels: 3, background: "white" } }).composite(layers).png().toFile(fileURLToPath(new URL(`candidates-${String(page + 1).padStart(2, "0")}.png`, destination)));
}
await writeFile(new URL("snapshot.json", destination), JSON.stringify(snapshot, null, 2));
process.stdout.write(`Review sheets: 36 originals + both engines; ${crops.length} displayed candidate crop pairs. No browser started.\n`);
