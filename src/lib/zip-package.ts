import { z } from "zod";
import type { AnnotatedExport } from "./annotated-export";
import type { ReportHistory } from "./pdf-report";
import type { AnnotationDraft } from "./annotations";
import { AppError } from "./policy";
export const zipLimits = {
	materials: 20,
	attachments: 20,
	entries: 64,
	bytes: 128 * 1024 * 1024,
	jsonBytes: 8 * 1024 * 1024,
	annotations: 2000,
	issues: 4000,
	history: 2000,
	fixed: 6000,
	memory: 512 * 1024 * 1024,
} as const;
const ids = (max: number) =>
	z
		.array(z.uuid())
		.max(max)
		.refine((value) => new Set(value).size === value.length);
export const zipSelectionSchema = z
	.object({
		materialIds: ids(zipLimits.materials),
		originals: z.boolean(),
		delivery: z
			.object({
				id: z.uuid(),
				fileIds: ids(zipLimits.attachments).refine((value) => value.length > 0),
			})
			.strict()
			.nullable(),
	})
	.strict()
	.refine((value) => value.materialIds.length > 0 || value.delivery !== null);
export type ZipSelection = z.infer<typeof zipSelectionSchema>;
export function zipSelectionQuery(selection: ZipSelection) {
	const query = new URLSearchParams();
	if (selection.materialIds.length)
		query.set("materials", selection.materialIds.join(","));
	if (selection.originals) query.set("originals", "1");
	if (selection.delivery) {
		query.set("delivery", selection.delivery.id);
		query.set("attachments", selection.delivery.fileIds.join(","));
	}
	return query.toString();
}
export function parseZipSelection(query: URLSearchParams): ZipSelection {
	if (
		[...query.keys()].some(
			(key) =>
				!["materials", "originals", "delivery", "attachments"].includes(key) ||
				query.getAll(key).length !== 1,
		) ||
		(query.has("originals") &&
			!["0", "1"].includes(query.get("originals") ?? "")) ||
		query.has("delivery") !== query.has("attachments")
	)
		throw new AppError("INVALID_INPUT", 422);
	const result = zipSelectionSchema.safeParse({
		materialIds: query.has("materials")
			? query.get("materials")?.split(",")
			: [],
		originals: query.get("originals") === "1",
		delivery: query.has("delivery")
			? {
					id: query.get("delivery"),
					fileIds: query.get("attachments")?.split(","),
				}
			: null,
	});
	if (!result.success) throw new AppError("INVALID_INPUT", 422);
	return result.data;
}
export type ZipFile = {
	id: string;
	filename: string;
	mime: string;
	byteSize: number;
	sha256: string;
	variant: "standard" | "material" | "original" | "delivery";
	deliveryId: string | null;
	path: string;
};
export const zipFileKey = (
	file: Pick<ZipFile, "id" | "variant" | "deliveryId">,
) => `${file.variant}:${file.deliveryId ?? ""}:${file.id}`;
export type ZipData = {
	schemaVersion: 1;
	capturedAt: string;
	photos: AnnotatedExport[];
	history: ReportHistory[];
	fixedAnnotations: {
		fileId: string;
		annotationId: string;
		revision: number;
		annotation: Pick<AnnotationDraft, "geometry" | "metadata">;
		source: "issue_snapshot";
	}[];
	delivery: null | {
		id: string;
		versionNo: number;
		revision: number;
		description: string;
		publishedAt: string;
		selectedFileIds: string[];
	};
};
export type ZipSnapshot = {
	schemaVersion: 1;
	snapshotId: string;
	capturedAt: string;
	project: { id: string; name: string; description: string; revision: number };
	selection: ZipSelection;
	files: ZipFile[];
	data: ZipData;
};
export function safeZipFilename(name: string) {
	let clean = name
		.normalize("NFC")
		.replace(/[\p{Cc}\p{Cf}<>:"/\\|?*]/gu, "_")
		.replace(/^\.+|[. ]+$/g, "")
		.trim();
	if (!clean || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean))
		clean = `file_${clean || "download"}`;
	const extension = clean.match(/\.[a-z0-9]{1,12}$/i)?.[0] ?? "",
		chars = Array.from(extension ? clean.slice(0, -extension.length) : clean),
		encoder = new TextEncoder();
	while (encoder.encode(chars.join("") + extension).length > 200) chars.pop();
	return (chars.join("").replace(/[. ]+$/g, "") || "download") + extension;
}
export const zipReadme = `PartMeasure ZIP资料包\r\n\r\nmanifest.json：schema版本、固定时间、文件路径／稳定ID／SHA256。\r\ndata.json：所选标准图与已保存标注／人工字段、回复／补测记录及相关固定快照。\r\nmaterials：标准WebP图片或原格式资料；originals：工程师明确选择的原始照片。\r\ndeliveries：所选已发布版本附件，不包含私有草稿。\r\n\r\n仅照片／无法测量不等于有尺寸。绿色仅表示已补充，不代表尺寸齐全或技术验收。\r\n旧记录只对应其固定修订；不得用后来几何解释旧数值。显示编号只在照片中定位。\r\n单位和数值均保留原来源，不从像素生成尺寸，不运行CV或AI。\r\n本包不重生成PNG／PDF，不是正式CAD工程图或可一键恢复的备份。\r\nZIP采用STORE方式，不额外压缩。清单记录数据文件及README的hash，不对自身自引用。\r\n已保存副本无法通过撤销分享收回，请妥善保管。\r\n`;
export function zipDataText(snapshot: ZipSnapshot) {
	return `${JSON.stringify({ ...snapshot.data, snapshotId: snapshot.snapshotId, project: snapshot.project }, null, 2)}\n`;
}
export function checkZipSnapshot(snapshot: ZipSnapshot) {
	const bytes = new TextEncoder().encode(zipDataText(snapshot)).length;
	const annotations = snapshot.data.photos.reduce(
			(sum, photo) => sum + photo.document.items.length,
			0,
		),
		issues = snapshot.data.photos.reduce(
			(sum, photo) => sum + photo.issues.length,
			0,
		);
	const sources = snapshot.files.reduce((sum, file) => sum + file.byteSize, 0);
	if (
		snapshot.files.length + 3 > zipLimits.entries ||
		!snapshot.files.length ||
		snapshot.files.some(
			(file) =>
				!Number.isSafeInteger(file.byteSize) ||
				file.byteSize < 1 ||
				!/^[a-f0-9]{64}$/.test(file.sha256),
		) ||
		bytes > zipLimits.jsonBytes ||
		annotations > zipLimits.annotations ||
		issues > zipLimits.issues ||
		snapshot.data.history.length > zipLimits.history ||
		snapshot.data.fixedAnnotations.length > zipLimits.fixed ||
		sources + bytes + 524288 > zipLimits.bytes ||
		sources * 2 +
			Math.max(...snapshot.files.map((file) => file.byteSize)) * 2 +
			bytes * 2 >
			zipLimits.memory
	)
		throw new AppError("ZIP_LIMIT", 413);
	return {
		dataBytes: bytes,
		sourceBytes: sources,
		reserve: (sources + bytes + 524288) * 2,
	};
}
