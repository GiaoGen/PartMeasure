import {
	type PdfReport,
	checkPdfReport,
	pdfLimits,
	pdfPhotoBlocks,
} from "@/lib/pdf-report";
import { rasterPdf, type RasterPdfPage } from "@/lib/raster-pdf";
import { exportLimits } from "@/lib/annotated-export";
import { AppError } from "@/lib/policy";
import { readApiTransport, apiSessionGuard } from "./api";
import {
	exportFont,
	runExport,
	breathe,
	wrapExportText,
	decodePhoto,
	drawExportAnnotations,
	nativeResult,
	readExportPhoto,
	authorizeExportPhotos,
} from "./render-annotated-export";
const pageWidth = 794,
	pageHeight = 1123,
	ratio = 2,
	left = 40,
	right = pageWidth - 40,
	bottom = pageHeight - 64,
	lineHeight = 23;
export type PlannedBlock = {
	title: string;
	lines: string[];
	continued: boolean;
	y: number;
};
export type PdfPagePlan = {
	photoIndex: number;
	photo: boolean;
	blocks: PlannedBlock[];
};
export function planPdfPages(
	report: PdfReport,
	measure: (text: string) => number,
): PdfPagePlan[] {
	checkPdfReport(report);
	const pages: PdfPagePlan[] = [];
	for (const [photoIndex, photo] of report.photos.entries()) {
		let current: PdfPagePlan = { photoIndex, photo: true, blocks: [] };
		pages.push(current);
		let y = 744;
		for (const block of pdfPhotoBlocks(report, photo)) {
			// Reserve heading height and split only between full wrapped lines.
			const lines = block.lines.flatMap((line) =>
				wrapExportText(line, measure, right - left),
			);
			const titleLines = wrapExportText(
				block.title,
				measure,
				right - left,
			).length;
			if (titleLines > 5) throw new AppError("PDF_LIMIT", 413);
			const header = titleLines * lineHeight + 8;
			const fullHeight = header + lines.length * lineHeight + 16;
			if (
				(fullHeight <= bottom - 110 && y + fullHeight > bottom) ||
				y + header + lineHeight > bottom
			) {
				current = { photoIndex, photo: false, blocks: [] };
				pages.push(current);
				y = 110;
			}
			let offset = 0;
			do {
				const count = Math.max(
					1,
					Math.floor((bottom - y - header - 16) / lineHeight),
				);
				const chunk = lines.slice(offset, offset + count);
				current.blocks.push({
					title: block.title,
					lines: chunk,
					continued: offset > 0,
					y,
				});
				y += header + chunk.length * lineHeight + 16;
				offset += chunk.length;
				if (offset < lines.length) {
					current = { photoIndex, photo: false, blocks: [] };
					pages.push(current);
					y = 110;
				}
				if (pages.length > pdfLimits.pages)
					throw new AppError("PDF_LIMIT", 413);
			} while (offset < lines.length);
		}
	}
	if (pages.length > pdfLimits.pages) throw new AppError("PDF_LIMIT", 413);
	return pages;
}
function printLines(
	context: CanvasRenderingContext2D,
	text: string[],
	y: number,
) {
	for (const [index, line] of text.entries())
		context.fillText(line, left, y + index * lineHeight);
}
/** Exported separately for an offline native-Canvas sample, without a browser. */
export async function renderPdfReport(
	report: PdfReport,
	source: (photoIndex: number) => Promise<Blob>,
	signal: AbortSignal,
	progress: (value: string) => void,
): Promise<Blob> {
	const canvas = document.createElement("canvas");
	const images: RasterPdfPage[] = [];
	let decoded: Awaited<ReturnType<typeof decodePhoto>> | undefined;
	try {
		const context = canvas.getContext("2d");
		if (!context) throw Error("PDF_CANVAS");
		context.font = `15px ${exportFont}`;
		// Bold text is wrapped using a wider font as well, to keep long headings safe.
		const measure = (text: string) => {
			context.font = `600 15px ${exportFont}`;
			return context.measureText(text).width;
		};
		const plans = planPdfPages(report, measure);
		let totalBytes = 0;
		for (const [pageIndex, plan] of plans.entries()) {
			signal.throwIfAborted();
			await breathe(signal);
			const photo = report.photos[plan.photoIndex];
			if (!photo) throw Error("PDF_PHOTO");
			progress(
				`生成PDF ${pageIndex + 1}/${plans.length}页 · 照片${plan.photoIndex + 1}/${report.photos.length}…`,
			);
			canvas.width = pageWidth * ratio;
			canvas.height = pageHeight * ratio;
			context.scale(ratio, ratio);
			context.fillStyle = "#ffffff";
			context.fillRect(0, 0, pageWidth, pageHeight);
			context.font = `600 20px ${exportFont}`;
			context.fillStyle = "#202833";
			const title = `PDF资料报告 · ${report.project.name}`;
			const titleLines = wrapExportText(
				title,
				(value) => context.measureText(value).width,
				right - left - 20,
			);
			context.fillText(
				titleLines.length > 1 ? `${titleLines[0]}…` : title,
				left,
				40,
			);
			context.font = `14px ${exportFont}`;
			const heading = `照片 ${plan.photoIndex + 1}/${report.photos.length} · ${photo.file.filename}${plan.photo ? "" : " · 续"}`;
			const headingLines = wrapExportText(
				heading,
				(value) => context.measureText(value).width,
				right - left,
			);
			printLines(
				context,
				headingLines.length > 2
					? [headingLines[0] ?? "", `${headingLines[1] ?? ""}…`]
					: headingLines,
				67,
			);
			if (plan.photo) {
				const image = photo.document.image,
					scale = Math.min((right - left) / image.width, 600 / image.height);
				const width = image.width * scale,
					height = image.height * scale,
					x = (pageWidth - width) / 2,
					y = 106 + (600 - height) / 2;
				const estimate =
					photo.file.byteSize * 2 +
					image.width * image.height * 4 +
					canvas.width * canvas.height * 8 +
					totalBytes * 2;
				if (estimate > exportLimits.memory)
					throw new AppError("PDF_LIMIT", 413);
				decoded = await decodePhoto(
					await source(plan.photoIndex),
					{
						width: Math.max(1, Math.round(width * ratio)),
						height: Math.max(1, Math.round(height * ratio)),
					},
					signal,
				);
				signal.throwIfAborted();
				context.drawImage(decoded.image, x, y, width, height);
				decoded.release();
				decoded = undefined;
				await drawExportAnnotations(
					context,
					photo,
					{ x, y, width, height },
					signal,
				);
				context.font = `13px ${exportFont}`;
				context.fillStyle = "#475467";
				context.fillText(
					"当前已保存标准图与标注；编号仅用于本照片定位。",
					left,
					726,
				);
			}
			for (const block of plan.blocks) {
				context.font = `600 15px ${exportFont}`;
				context.fillStyle = "#202833";
				const titles = wrapExportText(
					block.title,
					(value) => context.measureText(value).width,
					right - left,
				);
				printLines(context, titles, block.y);
				context.font = `15px ${exportFont}`;
				printLines(
					context,
					block.lines,
					block.y + titles.length * lineHeight + 8,
				);
				await breathe(signal);
			}
			context.strokeStyle = "#d0d5dd";
			context.lineWidth = 1;
			context.beginPath();
			context.moveTo(left, pageHeight - 48);
			context.lineTo(right, pageHeight - 48);
			context.stroke();
			context.font = `12px ${exportFont}`;
			context.fillStyle = "#475467";
			context.fillText(
				"已补充不等于尺寸齐全或技术验收 · 非正式CAD工程图",
				left,
				pageHeight - 28,
			);
			context.fillText(
				`${pageIndex + 1} / ${plans.length}`,
				right - 55,
				pageHeight - 28,
			);
			const image = await nativeResult(
				new Promise<Blob>((resolve, reject) =>
					canvas.toBlob(
						(blob) =>
							blob?.type === "image/jpeg"
								? resolve(blob)
								: reject(Error("PDF_ENCODING")),
						"image/jpeg",
						0.94,
					),
				),
				signal,
			);
			totalBytes += image.size;
			if (totalBytes > pdfLimits.bytes) throw new AppError("PDF_LIMIT", 413);
			images.push({ image, width: canvas.width, height: canvas.height });
		}
		return rasterPdf(images, signal);
	} finally {
		decoded?.release();
		images.length = 0;
		canvas.width = 0;
		canvas.height = 0;
	}
}
export async function generatePdfReport(
	base: string,
	fileIds: string[],
	signal: AbortSignal,
	progress: (value: string) => void,
) {
	return runExport(signal, async () => {
		const ensureSession = apiSessionGuard();
		progress("固定所选图片、标注与处理记录…");
		const report = await readApiTransport<PdfReport>(
			`${base}/pdf-report?ids=${fileIds.join(",")}`,
			signal,
		);
		ensureSession();
		signal.throwIfAborted();
		const blob = await renderPdfReport(
			report,
			async (index) => {
				const photo = report.photos[index];
				if (!photo) throw Error("PDF_PHOTO");
				return readExportPhoto(base, photo, signal);
			},
			signal,
			progress,
		);
		progress("检查全部图片的下载权限…");
		await authorizeExportPhotos(base, report.photos, signal);
		ensureSession();
		signal.throwIfAborted();
		return {
			blob,
			filename: `${report.project.name}-资料报告-${report.snapshotId.slice(0, 8)}.pdf`,
		};
	});
}
