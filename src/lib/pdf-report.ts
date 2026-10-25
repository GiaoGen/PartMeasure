import { z } from "zod";
import type {
	AnnotatedExport,
	ExportResponse,
	ExportIssue,
} from "./annotated-export";
import { exportDescription } from "./annotated-export";
import { AppError } from "./policy";
import { displayUnit } from "./annotation-collaboration";
import { typeLabel } from "./annotations";

export const pdfLimits = {
	photos: 8,
	pages: 60,
	bytes: 40 * 1024 * 1024,
	annotations: 800,
	records: 2000,
	characters: 120000,
	snapshotBytes: 2 * 1024 * 1024,
} as const;
export const pdfSelectionSchema = z
	.object({
		fileIds: z
			.array(z.uuid())
			.min(1)
			.max(pdfLimits.photos)
			.refine((ids) => new Set(ids).size === ids.length),
	})
	.strict();
export type ReportHistory = {
	id: string;
	fileId: string;
	annotationId: string;
	annotationRevision: number;
	issueId: string;
	issueRevision: number;
	createdAt: string;
	kind: "response" | "review" | "closure";
	record:
		| ExportResponse
		| NonNullable<ExportIssue["review"]>
		| { note: string };
};
export type PdfReport = {
	schemaVersion: 1;
	snapshotId: string;
	capturedAt: string;
	project: { id: string; name: string };
	photos: AnnotatedExport[];
	history: ReportHistory[];
};
export type PdfBlock = { title: string; lines: string[] };
export function pdfPhotoBlocks(
	report: PdfReport,
	photo: AnnotatedExport,
): PdfBlock[] {
	const descriptions = exportDescription(photo);
	const blocks: PdfBlock[] = [
		{ title: "图片与数据来源", lines: descriptions.slice(0, 5) },
	];
	// Section boundaries use the authoritative annotation headers, never parsed user text.
	let start = 5;
	if (!photo.document.items.length)
		blocks.push({ title: "标注", lines: ["暂无已保存标注。"] });
	for (const [index, item] of photo.document.items.entries()) {
		const next = photo.document.items[index + 1];
		const nextHeader = next
			? `${index + 2}. ${next.metadata.name || typeLabel(next.geometry)} · 修订 ${next.revision} · ID ${next.id}`
			: undefined;
		const end = nextHeader
			? descriptions.indexOf(nextHeader, start + 1)
			: descriptions.length;
		if (end < start) throw new AppError("EXPORT_LIMIT", 413);
		blocks.push({
			title: `标注 ${index + 1} · ${item.metadata.name || typeLabel(item.geometry)}`,
			lines: descriptions.slice(start, end),
		});
		start = end;
	}
	for (const entry of report.history.filter(
		(entry) => entry.fileId === photo.file.id,
	)) {
		const index = photo.document.items.findIndex(
			(item) => item.id === entry.annotationId,
		);
		const context = `标注 ${index + 1} · 固定修订 ${entry.annotationRevision} · ${entry.createdAt}`;
		const refs = `测量项 ${entry.issueId} r${entry.issueRevision} / 记录 ${entry.id}`;
		let lines: string[];
		if (entry.kind === "response") {
			const response = entry.record as ExportResponse;
			const author = response.authorType === "owner" ? "工程师" : "客户";
			const value =
				response.kind === "numeric"
					? `${response.value} ${displayUnit(response.unit)}（人工回复数值）`
					: response.kind === "photo"
						? "仅照片，无数值"
						: response.kind === "unable"
							? "无法测量，无数值"
							: "文字回复";
			lines = [
				`${author}回复：${value}`,
				response.body,
				...response.evidence.map(
					(file) => `证据：${file.filename} [${file.id}]`,
				),
			];
		} else if (entry.kind === "review") {
			const review = entry.record as NonNullable<ExportIssue["review"]>;
			const source =
				{
					customer_numeric: "客户数值",
					owner_from_photo: "工程师根据照片人工录入",
					owner_manual: "工程师人工录入",
					comment: "文字说明",
				}[review.source ?? ""] ?? "未标明";
			lines = [
				review.decision === "remeasure"
					? "工程师要求补测"
					: `历史确认：${review.value ?? "无数值"} ${displayUnit(review.unit)} · 来源：${source}`,
				review.note,
			];
		} else
			lines = [
				`工程师结束此测量项：${(entry.record as { note: string }).note}`,
			];
		blocks.push({
			title: `处理记录 · ${context}`,
			lines: [
				...lines.filter(Boolean),
				refs,
				"此记录仅属于上述固定修订，不替代当前工程字段或当前几何。",
			],
		});
	}
	return blocks;
}
export function checkPdfReport(report: PdfReport) {
	if (
		!report.photos.length ||
		report.photos.length > pdfLimits.photos ||
		report.history.length > pdfLimits.records ||
		report.photos.reduce((sum, photo) => sum + photo.document.items.length, 0) >
			pdfLimits.annotations ||
		new TextEncoder().encode(JSON.stringify(report)).length >
			pdfLimits.snapshotBytes
	)
		throw new AppError("PDF_LIMIT", 413);
	const characters = report.photos.reduce(
		(sum, photo) =>
			sum +
			pdfPhotoBlocks(report, photo).reduce(
				(sum, block) =>
					sum + block.title.length + block.lines.join("\n").length,
				0,
			),
		0,
	);
	if (characters > pdfLimits.characters) throw new AppError("PDF_LIMIT", 413);
}
