import sharp from "sharp";
import { storedZip, crc32 } from "../../src/lib/stored-zip";
import { sha256Bytes } from "../../src/components/generate-zip-package";
import { emptyMetadata } from "../../src/lib/annotations";
import type { ZipSnapshot, ZipFile } from "../../src/lib/zip-package";
export async function sampleZipPackage() {
	const ids = Array.from(
		{ length: 5 },
		(_, n) => `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
	);
	const imageId = ids[0],
		cadId = ids[1],
		deliveryId = ids[2],
		attachmentId = ids[3],
		annotationId = ids[4];
	if (!imageId || !cadId || !deliveryId || !attachmentId || !annotationId)
		throw Error("FIXTURE");
	const capturedAt = "2026-10-25T13:00:00.000Z",
		encoder = new TextEncoder();
	const source = sharp({
		create: { width: 20, height: 20, channels: 3, background: "#ccd5df" },
	});
	const original = new Uint8Array(await source.clone().png().toBuffer()),
		standard = new Uint8Array(await source.clone().webp().toBuffer());
	const cad = encoder.encode(
		"ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
	);
	const text = encoder.encode("合成成果附件，用于ZIP完整性检查。\n"),
		innerZip = storedZip(
			[{ path: "说明.txt", data: new Blob([text]), crc: crc32(text) }],
			capturedAt,
			new AbortController().signal,
		);
	const attached = new Uint8Array(await innerZip.arrayBuffer());
	const files: ZipFile[] = [
		{
			id: imageId,
			filename: "同名照片.png",
			mime: "image/webp",
			byteSize: standard.length,
			sha256: await sha256Bytes(standard),
			variant: "standard",
			deliveryId: null,
			path: `materials/${imageId}/同名照片.webp`,
		},
		{
			id: imageId,
			filename: "同名照片.png",
			mime: "application/octet-stream",
			byteSize: original.length,
			sha256: await sha256Bytes(original),
			variant: "original",
			deliveryId: null,
			path: `originals/${imageId}/同名照片.png`,
		},
		{
			id: cadId,
			filename: "零件.step",
			mime: "application/octet-stream",
			byteSize: cad.length,
			sha256: await sha256Bytes(cad),
			variant: "material",
			deliveryId: null,
			path: `materials/${cadId}/零件.step`,
		},
		{
			id: attachmentId,
			filename: "成果.zip",
			mime: "application/zip",
			byteSize: attached.length,
			sha256: await sha256Bytes(attached),
			variant: "delivery",
			deliveryId,
			path: `deliveries/V003/${attachmentId}/成果.zip`,
		},
	];
	const geometry = {
			type: "line" as const,
			from: { x: 0.1, y: 0.2 },
			to: { x: 0.9, y: 0.2 },
		},
		metadata = emptyMetadata();
	const snapshot: ZipSnapshot = {
		schemaVersion: 1,
		snapshotId: "f".repeat(64),
		capturedAt,
		project: {
			id: "P",
			name: "合成示例 · 零件资料",
			description: "不是实际业务数据或备份",
			revision: 3,
		},
		selection: {
			materialIds: [imageId, cadId],
			originals: true,
			delivery: { id: deliveryId, fileIds: [attachmentId] },
		},
		files,
		data: {
			schemaVersion: 1,
			capturedAt,
			photos: [
				{
					schemaVersion: 1,
					snapshotId: "e".repeat(64),
					capturedAt,
					project: { id: "P", name: "合成示例" },
					file: {
						id: imageId,
						filename: "同名照片.png",
						byteSize: standard.length,
					},
					document: {
						image: {
							id: imageId,
							width: 20,
							height: 20,
							imageHash: files[0]?.sha256 ?? "",
							normalizationVersion: 1,
						},
						items: [
							{
								id: annotationId,
								geometry,
								metadata,
								revision: 2,
								deleted: false,
								createdAt: capturedAt,
								updatedAt: capturedAt,
							},
						],
					},
					issues: [],
				},
			],
			history: [
				{
					id: "R",
					fileId: imageId,
					annotationId,
					annotationRevision: 1,
					issueId: "I",
					issueRevision: 1,
					createdAt: capturedAt,
					kind: "response",
					record: {
						id: "R",
						kind: "unable",
						value: null,
						unit: null,
						body: "当前工具无法测量，保留来源。",
						authorType: "guest",
						evidence: [],
					},
				},
			],
			fixedAnnotations: [
				{
					fileId: imageId,
					annotationId,
					revision: 1,
					annotation: { geometry, metadata },
					source: "issue_snapshot",
				},
			],
			delivery: {
				id: deliveryId,
				versionNo: 3,
				revision: 2,
				description: "合成发布版本",
				publishedAt: capturedAt,
				selectedFileIds: [attachmentId],
			},
		},
	};
	return {
		snapshot,
		bytes: new Map(
			files.map((file, index) => [
				file.path,
				[standard, original, cad, attached][index] as Uint8Array<ArrayBuffer>,
			]),
		),
	};
}
