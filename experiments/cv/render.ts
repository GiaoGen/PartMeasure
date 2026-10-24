import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { Geometry } from "../../src/lib/annotations";
import type { Candidate, LocalResult } from "./core";

const directory = new URL("../../tmp/p1-03/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8")) as { items: { id: string; canonicalPath: string; width: number; height: number }[] };
const escapeHtml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
function shape(g: Geometry, w: number, h: number, color: string, dash = "") {
	const common = `fill="none" stroke="${color}" stroke-width="3" ${dash ? 'stroke-dasharray="8 5"' : ""}`;
	if (g.type === "line") return `<path d="M${g.from.x * w},${g.from.y * h}L${g.to.x * w},${g.to.y * h}" ${common}/>`;
	if (g.type === "angle") return `<path d="M${g.from.x * w},${g.from.y * h}L${g.vertex.x * w},${g.vertex.y * h}L${g.to.x * w},${g.to.y * h}" ${common}/>`;
	if (g.type === "circle") return `<ellipse cx="${g.center.x * w}" cy="${g.center.y * h}" rx="${g.radiusX * w}" ry="${g.radiusY * h}" ${common}/>`;
	if (g.type === "ellipse") {
		const x = g.center.x * w, y = g.center.y * h;
		const rx = Math.hypot(g.axisA.x * w - x, g.axisA.y * h - y), ry = Math.hypot(g.axisB.x * w - x, g.axisB.y * h - y);
		const rotation = Math.atan2(g.axisA.y * h - y, g.axisA.x * w - x) * 180 / Math.PI;
		return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${rotation} ${x} ${y})" ${common}/>`;
	}
	return "";
}
await mkdir(new URL("results/overlays/", directory), { recursive: true });
const sections = [];
for (const sample of manifest.items) {
	for (const engine of ["baseline", "edge"] as const) {
	const resultPath = engine === "baseline" ? `results/${sample.id}.json` : `edge-drawing/view-${sample.id}.json`;
	const result = JSON.parse(await readFile(new URL(resultPath, directory), "utf8")) as { candidates: Candidate[]; locals: (LocalResult & { label: string })[]; totalMs: number };
	const outputId = `${engine}-${sample.id}`;
	const { width: w, height: h } = sample;
	const markings = result.candidates.map((candidate, index) => `${shape(candidate.geometry, w, h, "#ff2c74")}<text x="${candidate.pixel.x + 8}" y="${candidate.pixel.y}" fill="white" stroke="#172332" stroke-width="2" paint-order="stroke" font-family="Arial" font-size="18">${index + 1} ${candidate.geometry.type === "circle" ? "C" : "E"}</text>`).join("");
	await sharp(fileURLToPath(new URL(sample.canonicalPath, directory))).composite([{ input: Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${markings}</svg>`) }]).png().toFile(fileURLToPath(new URL(`results/overlays/${outputId}.png`, directory)));
	sections.push(`<section><h2>${outputId} · ${result.candidates.length} 候选</h2><p>${result.totalMs.toFixed(1)} ms，${engine === "baseline" ? "Node/WASM" : "原生离线"}计算，不能直接比较运行速度；C=圆，E=椭圆，不表示物理孔。</p><a href="overlays/${outputId}.png"><img loading="lazy" src="overlays/${outputId}.png" alt="${sample.id}候选叠图"></a></section>`);
	for (let i = 0; i < result.locals.length; i++) {
		const local = result.locals[i];
		if (!local) continue;
		const overlay = shape(local.input, w, h, "#697586", "dash") + shape(local.output, w, h, "#175cd3");
		const probeId = `${outputId}-probe-${i + 1}`;
		await sharp(fileURLToPath(new URL(sample.canonicalPath, directory))).composite([{ input: Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${overlay}</svg>`) }]).png().toFile(fileURLToPath(new URL(`results/overlays/${probeId}.png`, directory)));
		sections.push(`<section><h2>${outputId} 技术探针 ${i + 1} · ${escapeHtml(local.label)}</h2><p>虚线=预置粗画，蓝线=输出；${local.changed ? "已调整，是否正确待独立审阅" : "保留原形"} · ${local.reason}</p><a href="overlays/${probeId}.png"><img loading="lazy" src="overlays/${probeId}.png" alt="技术探针对照"></a></section>`);
	}
	}
}
for (const engine of ["baseline", "edge"]) {
	const composites = [];
	for (const [index, sample] of manifest.items.entries()) {
		const thumbnail = await sharp(fileURLToPath(new URL(`results/overlays/${engine}-${sample.id}.png`, directory))).resize(220, 220).png().toBuffer();
		const left = (index % 6) * 220, top = Math.floor(index / 6) * 244;
		composites.push({ input: thumbnail, left, top });
		composites.push({ input: Buffer.from(`<svg width="220" height="24"><rect width="220" height="24" fill="white"/><text x="4" y="17" font-family="Arial" font-size="12">${sample.id}</text></svg>`), left, top: top + 220 });
	}
	await sharp({ create: { width: 1320, height: 1464, channels: 3, background: "white" } }).composite(composites).png().toFile(fileURLToPath(new URL(`results/contact-${engine}.png`, directory)));
}
await writeFile(new URL("results/gallery.html", directory), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>P1-03 本地观察记录</title><style>body{font:15px/1.6 system-ui;margin:24px;color:#263548}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,390px),1fr));gap:24px}section{border-top:1px solid #ccd3dd;padding-top:10px;min-width:0}h1{font-size:24px}h2{font-size:16px}p{color:#546578}img{display:block;width:100%;height:auto}a{color:#245dcb}</style><h1>P1-03 · 真实照片技术观察</h1><p>非商业本地研究。照片：Jezek 等，MPDD 2021；<a href="https://github.com/stepanje/MPDD">来源</a> · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>。叠图为本实验修改，点击可放大。候选不是真值，不以这些图计算精确率或真实尺寸。</p><p><a href="contact-baseline.png">Canny/Hough 全36张总览</a> · <a href="contact-edge.png">EdgeDrawing 全36张总览</a>。同一照片分别展示两种算法，灰虚线为预置粗画，蓝线为输出；探针不是人工效率或独立真值。</p><main>${sections.join("")}</main></html>`);
process.stdout.write("Local overlays and gallery rendered; no browser started.\n");
