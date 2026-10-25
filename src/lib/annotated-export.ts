import type {
	Annotation,
	AnnotationDocument,
	AnnotationDraft,
} from "./annotations";
import { typeLabel, sameContent } from "./annotations";
import { geometryTarget } from "./geometry-extensions";
import {
	measurementFieldLabel,
	requiredMeasurements,
	displayUnit,
	type MeasurementField,
} from "./annotation-collaboration";
import { measurementText } from "./annotation-presentation";
import { AppError } from "./policy";

export const exportLimits = {
	sourcePixels: 40_000_000,
	sourceBytes: 80 * 1024 * 1024,
	annotations: 200,
	issues: 1000,
	characters: 60000,
	edge: 4096,
	pixels: 16_000_000,
	canvasEdge: 16384,
	memory: 512 * 1024 * 1024,
} as const;
export type ExportResponse = {
	id: string;
	kind: "numeric" | "photo" | "unable" | "text";
	value: string | null;
	unit: string | null;
	body: string;
	authorType: "owner" | "guest";
	evidence: { id: string; filename: string }[];
};
export type ExportIssue = {
	id: string;
	annotationId: string;
	annotationRevision: number;
	revision: number;
	field: MeasurementField;
	state: string;
	snapshot: Pick<AnnotationDraft, "geometry" | "metadata">;
	response: ExportResponse | null;
	review?: {
		id: string;
		decision: "confirm" | "remeasure";
		value: string | null;
		unit: string | null;
		source: string | null;
		note: string;
	} | null;
};
export type AnnotatedExport = {
	schemaVersion: 1;
	snapshotId: string;
	capturedAt: string;
	project: { id: string; name: string };
	file: { id: string; filename: string; byteSize: number };
	document: AnnotationDocument;
	issues: ExportIssue[];
};
export function compatibleExportReply(
	item: AnnotationDraft,
	issue: ExportIssue,
) {
	return (
		requiredMeasurements(item).includes(issue.field) &&
		sameContent(
			geometryTarget(item.geometry),
			geometryTarget(issue.snapshot.geometry),
		) &&
		(item.geometry.type !== "circle" ||
			item.metadata.circleMeasure === issue.snapshot.metadata.circleMeasure)
	);
}
export function exportPhotoSize(width: number, height: number) {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1 ||
		width * height > exportLimits.sourcePixels
	)
		throw new AppError("EXPORT_LIMIT", 413);
	// Leave room for provenance below common square photos within the 16MP sheet.
	const scale = Math.min(
		1,
		exportLimits.edge / Math.max(width, height),
		Math.sqrt(10_000_000 / (width * height)),
	);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}
export function checkExportSize(snapshot: Omit<AnnotatedExport, "snapshotId">) {
	exportPhotoSize(
		snapshot.document.image.width,
		snapshot.document.image.height,
	);
	if (
		!Number.isSafeInteger(snapshot.file.byteSize) ||
		snapshot.file.byteSize < 1 ||
		snapshot.file.byteSize > exportLimits.sourceBytes ||
		snapshot.document.items.length > exportLimits.annotations ||
		snapshot.issues.length > exportLimits.issues ||
		JSON.stringify(snapshot).length > 400000
	)
		throw new AppError("EXPORT_LIMIT", 413);
}
function ownerFields(item: Annotation) {
	const fields: MeasurementField[] = [
		"dimension",
		"holeDepth",
		"angleValue",
		"arcLength",
		"majorRadius",
	];
	return fields
		.filter((field) => !!item.metadata[field])
		.map(
			(field) =>
				`${measurementFieldLabel(item, field)} ${measurementText(item, field)}（工程师人工）`,
		)
		.join("；");
}
export function exportDescription(snapshot: AnnotatedExport): string[] {
	const { image, items } = snapshot.document;
	const lines = [
		`项目：${snapshot.project.name} / 图片：${snapshot.file.filename}`,
		`当前已保存状态 · 固定于 ${snapshot.capturedAt} · ${image.width} × ${image.height}px 标准图`,
		"绿色仅表示已补充，不代表尺寸齐全或技术验收；非正式 CAD 工程图。",
		`文件 ID：${image.id} · 标准图 SHA256：${image.imageHash}`,
		`快照：${snapshot.snapshotId} · schema ${snapshot.schemaVersion}`,
	];
	if (!items.length) lines.push("暂无已保存标注。");
	items.forEach((item, index) => {
		lines.push(
			`${index + 1}. ${item.metadata.name || typeLabel(item.geometry)} · 修订 ${item.revision} · ID ${item.id}`,
		);
		if (item.geometry.type === "text")
			lines.push(`文字：${item.geometry.text}`);
		const fields = ownerFields(item);
		lines.push(fields || "工程师人工尺寸：未填写");
		if (item.metadata.holeType)
			lines.push(
				`孔型：${{ through: "通孔", blind: "盲孔", threaded: "螺纹孔", counterbore: "沉孔", countersink: "沉头孔", other: "其他" }[item.metadata.holeType]}`,
			);
		if (item.metadata.thread) lines.push(`螺纹：${item.metadata.thread}`);
		if (item.metadata.notes) lines.push(`备注：${item.metadata.notes}`);
		const issues = snapshot.issues.filter(
			(issue) => issue.annotationId === item.id,
		);
		for (const issue of issues) {
			const reply = issue.response,
				compatible = compatibleExportReply(item, issue);
			const state =
				{
					awaiting_response: "待补充",
					remeasure_requested: "待补测",
					submitted: "已补充",
					confirmed: "历史已确认记录",
				}[issue.state] ?? issue.state;
			const heading = `${measurementFieldLabel({ ...item, ...issue.snapshot }, issue.field)}：${state}`;
			const context = compatible
				? "当前位置"
				: `旧位置／取值方式，仅属固定修订 ${issue.annotationRevision}，不套用当前几何`;
			const value = !reply
				? "暂无回复"
				: reply.kind === "numeric"
					? `${reply.value} ${displayUnit(reply.unit)}（${reply.authorType === "owner" ? "工程师" : "客户"}回复数值）`
					: reply.kind === "photo"
						? "仅照片，无数值"
						: reply.kind === "unable"
							? "无法测量，无数值"
							: "文字回复";
			lines.push(`${heading} · ${context} · ${value}`);
			if (reply?.body) lines.push(`回复说明：${reply.body}`);
			lines.push(
				`测量项 ${issue.id} r${issue.revision} / 标注固定修订 ${issue.annotationRevision}${reply ? ` / 回复 ${reply.id}` : ""}`,
			);
			if (reply?.evidence.length)
				lines.push(
					`证据：${reply.evidence.map((file) => `${file.filename} [${file.id}]`).join("；")}`,
				);
			if (issue.review) {
				const review = issue.review;
				const source =
					{
						customer_numeric: "客户数值",
						owner_from_photo: "工程师根据照片人工录入",
						owner_manual: "工程师人工录入",
						comment: "说明",
					}[review.source ?? ""] ?? "未标明";
				lines.push(
					review.decision === "remeasure"
						? `补测原因：${review.note} [${review.id}]`
						: `历史确认记录：${review.value ?? "无数值"} ${displayUnit(review.unit)} · 来源 ${source} · ${review.note} [${review.id}]（不替代当前工程字段）`,
				);
			}
		}
	});
	if (lines.join("\n").length > exportLimits.characters)
		throw new AppError("EXPORT_LIMIT", 413);
	return lines;
}
/** No silent cropping: all lines must fit the bounded output. */
export function exportCanvasSize(
	photo: { width: number; height: number },
	lineCount: number,
) {
	const width = Math.max(1280, photo.width + 48),
		height = photo.height + 104 + lineCount * 28 + 48;
	if (
		width > exportLimits.canvasEdge ||
		height > exportLimits.canvasEdge ||
		width * height > exportLimits.pixels
	)
		throw new AppError("EXPORT_LIMIT", 413);
	return { width, height };
}
