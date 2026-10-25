import {
	emptyMetadata,
	type Annotation,
	type Geometry,
} from "../../src/lib/annotations";
import type { AnnotatedExport } from "../../src/lib/annotated-export";
import type { PdfReport } from "../../src/lib/pdf-report";
const time = "2026-10-25T12:00:00.000Z";
export function samplePdfReport(): PdfReport {
	const geometries: Geometry[] = [
		{ type: "line", from: { x: 0.1, y: 0.15 }, to: { x: 0.7, y: 0.15 } },
		{
			type: "circle",
			center: { x: 0.3, y: 0.4 },
			radiusX: 0.07,
			radiusY: (0.07 * 1600) / 1200,
		},
		{ type: "point", at: { x: 0.1, y: 0.7 } },
		{ type: "text", at: { x: 0.6, y: 0.85 }, text: "安装面，请保留此处倒角" },
		{
			type: "angle",
			vertex: { x: 0.6, y: 0.4 },
			from: { x: 0.8, y: 0.4 },
			to: { x: 0.6, y: 0.2 },
			reflex: false,
		},
		{
			type: "arc",
			from: { x: 0.65, y: 0.7 },
			via: { x: 0.75, y: 0.6 },
			to: { x: 0.85, y: 0.7 },
		},
		{
			type: "ellipse",
			center: { x: 0.4, y: 0.7 },
			axisA: { x: 0.5, y: 0.75 },
			axisB: { x: 0.38, y: 0.77 },
		},
	];
	const items: Annotation[] = geometries.map((geometry, index) => ({
		id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
		geometry,
		metadata: {
			...emptyMetadata(),
			name:
				[
					"安装边长度",
					"安装孔",
					"基准点",
					"加工说明",
					"两面夹角",
					"过渡圆弧",
					"斜拍孔径",
				][index] ?? "标注",
		},
		revision: index + 1,
		deleted: false,
		createdAt: time,
		updatedAt: time,
	}));
	const line = items[0],
		angle = items[4],
		arc = items[5];
	if (!line || !angle || !arc) throw Error("FIXTURE");
	line.metadata.dimension = "125.6";
	angle.metadata.angleValue = "90";
	arc.metadata.dimension = "15";
	const first: AnnotatedExport = {
		schemaVersion: 1,
		snapshotId: "b".repeat(64),
		capturedAt: time,
		project: { id: "P", name: "合成示例 · 安装板资料报告" },
		file: { id: "F1", filename: "正面-七类标注.png", byteSize: 10000 },
		document: {
			image: {
				id: "F1",
				width: 1600,
				height: 1200,
				imageHash: "a".repeat(64),
				normalizationVersion: 1,
			},
			items,
		},
		issues: [],
	};
	const second: AnnotatedExport = structuredClone(first);
	second.file.id = "F2";
	second.file.filename = "背面-长说明.jpg";
	second.document.image.id = "F2";
	second.document.image.width = 1200;
	second.document.image.height = 1600;
	second.document.items = [
		{
			...structuredClone(line),
			id: "00000000-0000-4000-8000-999999999999",
			geometry: {
				type: "text",
				at: { x: 0.5, y: 0.4 },
				text: "孔位说明，请参照工程师人工填写字段",
			},
			metadata: {
				...emptyMetadata(),
				name: "完整备注与续页",
				notes: `${"长备注测试：这段说明需要完整换行，分页时保留前后语义，不截掉任何字行。".repeat(56)}末尾核对：END-完整保留。`,
			},
		},
	];
	return {
		schemaVersion: 1,
		snapshotId: "c".repeat(64),
		capturedAt: time,
		project: first.project,
		photos: [first, second],
		history: [
			{
				id: "R1",
				fileId: "F1",
				annotationId: line.id,
				annotationRevision: 1,
				issueId: "I1",
				issueRevision: 1,
				createdAt: time,
				kind: "response",
				record: {
					id: "R1",
					kind: "numeric",
					value: "125.5",
					unit: "mm",
					body: "客户卡尺人工读数。此值属于当时固定修订，当前工程师人工值单独列出。",
					authorType: "guest",
					evidence: [{ id: "E1", filename: "卡尺读数照片.jpg" }],
				},
			},
			{
				id: "V1",
				fileId: "F1",
				annotationId: line.id,
				annotationRevision: 1,
				issueId: "I1",
				issueRevision: 2,
				createdAt: time,
				kind: "review",
				record: {
					id: "V1",
					decision: "remeasure",
					value: null,
					unit: null,
					source: null,
					note: "请检查是否夹到了倒角，并换方向补测。",
				},
			},
			{
				id: "R2",
				fileId: "F1",
				annotationId: line.id,
				annotationRevision: 1,
				issueId: "I1",
				issueRevision: 3,
				createdAt: time,
				kind: "response",
				record: {
					id: "R2",
					kind: "unable",
					value: null,
					unit: null,
					body: "现有工具无法测量，仅保留说明。",
					authorType: "guest",
					evidence: [],
				},
			},
		],
	};
}
