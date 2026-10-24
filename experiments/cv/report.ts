import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { Geometry } from "../../src/lib/annotations";

const root = new URL("../../tmp/p1-03/", import.meta.url);
const evidence = JSON.parse(await readFile(new URL("../../docs/evidence/p1-03/agent-evaluation.json", import.meta.url), "utf8")) as {
	trials: { engine: string; targetId: string; imageId: string; type: string; variant: string; outcome: string; input: Geometry; output: Geometry; before: { meanPx: number }; after: { meanPx: number } }[];
};
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8")) as { items: { id: string; canonicalPath: string; width: number; height: number }[] };
const examples = [
	{ id: "line", target: "black01-edge", variant: "translate:6,0", title: "线段：粗画后贴近外边缘", note: "清晰直边可改善定位。局部范围保留，仍需普通保存。" },
	{ id: "angle", target: "plate01-corner", variant: "translate:8,-8", title: "角度：两条边共同调整顶点", note: "只贴合照片中的两条边，不推断真实零件角度。" },
	{ id: "circle", target: "plate01-circle", variant: "translate:8,-8", title: "圆：偏移草稿贴近可见孔边", note: "这里只确定图像位置，孔径仍由人工填写。" },
	{ id: "ellipse", target: "plate02-ellipse", variant: "translate:-8,8", title: "椭圆：斜拍轮廓保留椭圆外观", note: "斜拍孔边可改善；小孔与扁管口经常保持原画。" },
	{ id: "fallback", target: "tubes03-end", variant: "translate:6,0", title: "回退：扁管口没有可靠匹配", note: "保留原草稿，用户可以继续手调。蓝线与原画重合。" },
	{ id: "wrong-edge", target: "white05-edge", variant: "translate:8,-8", title: "限制：反光处可能贴到另一条边", note: "这次调整更偏离参考外边缘。正式接入须可关闭、单步撤销。" },
];
const directory = new URL("results/examples/", root);
await mkdir(directory, { recursive: true });
function shape(g: Geometry, w: number, h: number, color: string, dashed: boolean) {
	const style = `fill="none" stroke="${color}" stroke-width="2" ${dashed ? 'stroke-dasharray="7 5"' : ""}`;
	if (g.type === "line") return `<path d="M${g.from.x * w},${g.from.y * h}L${g.to.x * w},${g.to.y * h}" ${style}/>`;
	if (g.type === "angle") return `<path d="M${g.from.x * w},${g.from.y * h}L${g.vertex.x * w},${g.vertex.y * h}L${g.to.x * w},${g.to.y * h}" ${style}/>`;
	if (g.type === "circle") return `<ellipse cx="${g.center.x * w}" cy="${g.center.y * h}" rx="${g.radiusX * w}" ry="${g.radiusY * h}" ${style}/>`;
	if (g.type === "ellipse") {
		const x = g.center.x * w, y = g.center.y * h, ax = g.axisA.x * w - x, ay = g.axisA.y * h - y, bx = g.axisB.x * w - x, by = g.axisB.y * h - y;
		return `<ellipse cx="${x}" cy="${y}" rx="${Math.hypot(ax, ay)}" ry="${Math.hypot(bx, by)}" transform="rotate(${Math.atan2(ay, ax) * 180 / Math.PI} ${x} ${y})" ${style}/>`;
	}
	return "";
}
const sections = [];
for (const example of examples) {
	const trial = evidence.trials.find(t => t.engine === "baseline" && t.targetId === example.target && t.variant === example.variant);
	if (!trial) throw Error(`EXAMPLE_MISSING:${example.id}`);
	const sample = manifest.items.find(s => s.id === trial.imageId);
	if (!sample) throw Error("PHOTO_MISSING");
	const { width: w, height: h } = sample;
	const reference = evidence.trials.find(t => t.engine === "baseline" && t.targetId === trial.targetId && t.variant === "reference")?.input;
	if (!reference) throw Error("REFERENCE_MISSING");
	// Display a crop of the task, not the entire busy photograph. SVG geometry
	// is drawn in canonical coordinates before cropping; no coordinate rescale.
	const points = reference.type === "line" ? [reference.from, reference.to] : reference.type === "angle" ? [reference.from, reference.vertex, reference.to] : reference.type === "circle" ? [{ x: reference.center.x - reference.radiusX, y: reference.center.y - reference.radiusY }, { x: reference.center.x + reference.radiusX, y: reference.center.y + reference.radiusY }] : reference.type === "ellipse" ? [reference.center, reference.axisA, reference.axisB] : [];
	const round = reference.type === "circle" || reference.type === "ellipse", margin = round ? 95 : 40;
	const left = Math.max(0, Math.floor(Math.min(...points.map(p => p.x * w)) - margin)), top = Math.max(0, Math.floor(Math.min(...points.map(p => p.y * h)) - margin));
	const width = Math.min(w - left, Math.ceil(Math.max(...points.map(p => p.x * w)) + margin) - left), height = Math.min(h - top, Math.ceil(Math.max(...points.map(p => p.y * h)) + margin) - top);
	const layers = [];
	for (const [i, g] of [trial.input, trial.output].entries()) {
		const overlay = shape(g, w, h, i === 0 ? "#344054" : "#175cd3", i === 0);
		const picture = await sharp(fileURLToPath(new URL(sample.canonicalPath, root))).composite([{ input: Buffer.from(`<svg width="${w}" height="${h}">${overlay}</svg>`) }]).png().toBuffer();
		layers.push({ input: await sharp(picture).extract({ left, top, width, height }).resize(360, 330, { fit: "contain", background: "#f2f4f7" }).png().toBuffer(), left: i * 360, top: 0 });
	}
	await sharp({ create: { width: 720, height: 330, channels: 3, background: "white" } }).composite(layers).png().toFile(fileURLToPath(new URL(`${example.id}.png`, directory)));
	sections.push(`<section><h2>${example.title}</h2><img src="examples/${example.id}.png" alt="左为预置粗画，右为OpenCV.js输出"><p>${example.note}</p><small>${trial.imageId} · 参考轮廓平均偏差 ${trial.before.meanPx.toFixed(1)} → ${trial.after.meanPx.toFixed(1)} px</small></section>`);
}
await writeFile(new URL("results/report.html", root), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>P1-03 · 实验结论</title><style>body{margin:0;background:#fff;color:#344054;font:15px/1.7 system-ui}main{max-width:1080px;margin:36px auto;padding:0 20px}h1{font-size:26px;color:#101828}h2{font-size:17px;color:#101828;margin:0 0 12px}p{margin:8px 0 16px}a{color:#175cd3}nav{display:flex;gap:24px;margin:20px 0 28px}table{border-collapse:collapse;width:100%;margin:20px 0 28px}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #eaecf0}th{color:#475467;background:#f9fafb}.examples{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:28px}section{border-top:1px solid #d0d5dd;padding-top:18px;min-width:0}img{display:block;width:100%;height:auto;border-radius:4px}small{color:#667085}</style><main><h1>P1-03 · CV 真实照片实验结论</h1><p><strong>值得做轻量 OpenCV.js 接入：清晰目标提供一点辅助，复杂照片保留手动操作。</strong>按 2026-10-25 调整后的实验标准收尾；没有将 CV 作为核心能力或高精度识别系统。</p><p>你无需填写试验表。已完成 36 张照片、两种算法、114 个候选审查，以及 24 个参考任务的 432 次技术扰动对照。以下是我挑出的效果、回退和失败实例。</p><nav><a href="gallery.html">查看全部照片与算法输出</a><a href="manual.html">可选：操作试验页</a></nav><table><tr><th>能力</th><th>结论</th></tr><tr><td>手画线段／角度／圆／椭圆后贴合</td><td>清晰目标存在改善；反光、多边缘和小孔不保证成功，须可关闭和撤销。</td></tr><tr><td>主动识别圆／椭圆候选</td><td>适合少量候选人工选用；候选不等于孔，未选中不保存。</td></tr><tr><td>算法选择</td><td>优先已有 OpenCV.js；EdgeDrawing 保留为离线参考，本轮不承担额外浏览器编译成本。</td></tr></table><h2>左：粗画输入　右：OpenCV.js 输出</h2><p>粗画由参考坐标按固定偏移生成；这些是技术示例，不是工程师真实操作记录。像素偏差只帮助观察定位，不能换算实测尺寸；参考坐标也有约 2–6px 的视觉判断不确定性。</p><div class="examples">${sections.join("")}</div><p>真实用户完成时间、实际修正与撤销次数、浏览器交互及手机响应未实测，未声明通过。本阶段没有接入正式编辑器；P1-04 需另行授权。</p><small>图片：Jezek 等，MPDD 2021；<a href="https://github.com/stepanje/MPDD">来源</a>，<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>。裁切和叠图为实验修改，仅本机非商业研究。</small></main></html>`);
process.stdout.write("Read-only conclusion page and six real-photo comparison examples generated; no browser started.\n");
