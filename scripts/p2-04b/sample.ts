// Offline native Canvas adapter for the exact application renderer. No browser,
// business data, Auth or Storage calls; runtime libraries are not app dependencies.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { samplePdfReport } from "../../tests/fixtures/pdf-report";
import {
	renderPdfReport,
	planPdfPages,
} from "../../src/components/render-pdf-report";
const runtime = process.env.PM_SAMPLE_NODE_MODULES;
if (!runtime) throw Error("PM_SAMPLE_NODE_MODULES_REQUIRED");
const require = createRequire(`${runtime.replaceAll("\\", "/")}/runtime.cjs`);
const {
	createCanvas,
	loadImage,
	Path2D,
	GlobalFonts,
} = require("@napi-rs/canvas");
GlobalFonts.registerFromPath("C:/Windows/Fonts/msyh.ttc", "Microsoft YaHei");
Object.assign(globalThis, {
	document: {
		createElement: () => {
			const canvas = createCanvas(1, 1);
			canvas.toBlob = (
				callback: (blob: Blob) => void,
				mime: string,
				quality: number,
			) => {
				setTimeout(
					() =>
						callback(
							new Blob([canvas.toBuffer(mime, Math.round(quality * 100))], {
								type: mime,
							}),
						),
					0,
				);
			};
			return canvas;
		},
	},
	Path2D,
	createImageBitmap: async (blob: Blob) => {
		const image = await loadImage(Buffer.from(await blob.arrayBuffer()));
		image.close = () => {};
		return image;
	},
});
const report = samplePdfReport(),
	source = createCanvas(1600, 1200),
	context = source.getContext("2d");
context.fillStyle = "#eef1f4";
context.fillRect(0, 0, 1600, 1200);
context.fillStyle = "#c4ccd5";
context.fillRect(120, 110, 1300, 940);
context.strokeStyle = "#566574";
context.lineWidth = 8;
context.strokeRect(120, 110, 1300, 940);
context.fillStyle = "#ffffff";
context.beginPath();
context.arc(480, 480, 112, 0, Math.PI * 2);
context.fill();
context.fillStyle = "#344054";
context.font = '32px "Microsoft YaHei"';
context.fillText("合成样本 - 用于检查中文、标注与分页", 160, 1130);
const bytes = source.toBuffer("image/webp"),
	blob = new Blob([bytes], { type: "image/webp" });
const measureCanvas = createCanvas(1, 1),
	measure = measureCanvas.getContext("2d");
measure.font = '600 15px "Microsoft YaHei"';
const plans = planPdfPages(report, (text) => measure.measureText(text).width);
const pdf = await renderPdfReport(
	report,
	async () => blob,
	new AbortController().signal,
	() => {},
);
await mkdir("output/pdf", { recursive: true });
await mkdir("docs/evidence/p2-04b", { recursive: true });
await writeFile(
	"output/pdf/p2-04b-synthetic-report.pdf",
	Buffer.from(await pdf.arrayBuffer()),
);
await writeFile(
	"docs/evidence/p2-04b/sample.json",
	`${JSON.stringify({ environment: "offline native Canvas adapter; synthetic data only, not browser or Supabase acceptance", pages: plans.length, bytes: pdf.size, photoStarts: plans.flatMap((page, index) => (page.photo ? [index + 1] : [])), continuedBlocks: plans.reduce((sum, page) => sum + page.blocks.filter((block) => block.continued).length, 0), lastTextPresent: plans.some((page) => page.blocks.some((block) => block.lines.some((line) => line.includes("END-完整保留")))) }, null, 2)}\n`,
);
console.log(JSON.stringify({ pages: plans.length, bytes: pdf.size }));
