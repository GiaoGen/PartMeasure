import { expect, it, vi } from "vitest";
import {
	emptyMetadata,
	type Annotation,
	type Geometry,
} from "../../src/lib/annotations";
import {
	checkExportSize,
	compatibleExportReply,
	exportCanvasSize,
	exportDescription,
	exportPhotoSize,
	type AnnotatedExport,
	type ExportIssue,
} from "../../src/lib/annotated-export";
import { geometryPaths } from "../../src/lib/annotation-presentation";
vi.mock("../../src/components/api", async (original) => ({
	...(await original<object>()),
	apiSessionGuard: vi.fn(),
	readApiTransport: vi.fn(),
}));
import { apiSessionGuard, readApiTransport } from "../../src/components/api";
import {
	abortableExport,
	wrapExportText,
	renderAnnotatedExport,
	generateAnnotatedExport,
} from "../../src/components/render-annotated-export";
const geometries: Geometry[] = [
	{ type: "line", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
	{ type: "circle", center: { x: 0.5, y: 0.5 }, radiusX: 0.1, radiusY: 0.2 },
	{ type: "point", at: { x: 0.1, y: 0.2 } },
	{ type: "text", at: { x: 0.5, y: 0.5 }, text: "中文备注 <> &" },
	{
		type: "angle",
		from: { x: 0.2, y: 0.5 },
		vertex: { x: 0.5, y: 0.5 },
		to: { x: 0.5, y: 0.2 },
		reflex: true,
	},
	{
		type: "arc",
		from: { x: 0.2, y: 0.5 },
		via: { x: 0.5, y: 0.2 },
		to: { x: 0.8, y: 0.5 },
	},
	{
		type: "ellipse",
		center: { x: 0.5, y: 0.5 },
		axisA: { x: 0.7, y: 0.7 },
		axisB: { x: 0.4, y: 0.6 },
	},
];
const annotation = (geometry = geometries[0] as Geometry): Annotation => ({
	id: "A",
	geometry,
	metadata: emptyMetadata(),
	revision: 2,
	deleted: false,
	createdAt: "now",
	updatedAt: "now",
});
const issue = (item: Annotation): ExportIssue => ({
	id: "I",
	annotationId: item.id,
	annotationRevision: 1,
	revision: 3,
	field: "dimension",
	state: "submitted",
	snapshot: {
		geometry: structuredClone(item.geometry),
		metadata: emptyMetadata(),
	},
	response: {
		id: "R",
		kind: "photo",
		value: null,
		unit: null,
		body: "仅提供照片",
		authorType: "guest",
		evidence: [{ id: "E", filename: "证据.png" }],
	},
});
const snapshot = (): AnnotatedExport => ({
	schemaVersion: 1,
	snapshotId: "snapshot-hash",
	capturedAt: "fixed-time",
	project: { id: "P", name: "零件" },
	file: { id: "F", filename: "正面.jpg", byteSize: 8 },
	document: {
		image: {
			id: "F",
			imageHash: "a".repeat(64),
			width: 800,
			height: 400,
			normalizationVersion: 1,
		},
		items: [annotation()],
	},
	issues: [],
});
it("retains photo-only, unable, pending and remeasure status without inventing a dimension", () => {
	const value = snapshot(),
		item = value.document.items[0] as Annotation;
	const current = issue(item);
	value.issues = [current];
	const text = exportDescription(value).join("\n");
	expect(text).toContain("仅照片，无数值");
	expect(text).toContain("工程师人工尺寸：未填写");
	expect(text).toContain("证据.png [E]");
	expect(text).toContain("不代表尺寸齐全");
	if (!current.response) throw Error("Missing test response");
	current.response.kind = "unable";
	expect(exportDescription(value).join("\n")).toContain("无法测量，无数值");
	current.state = "remeasure_requested";
	expect(exportDescription(value).join("\n")).toContain("待补测");
	current.state = "awaiting_response";
	current.response = null;
	expect(exportDescription(value).join("\n")).toContain("待补充");
});
it("keeps Owner values and customer units distinct, with stable source references", () => {
	const value = snapshot(),
		item = value.document.items[0] as Annotation;
	item.metadata.dimension = "12";
	const current = issue(item);
	value.issues = [current];
	if (!current.response) throw Error("Missing test response");
	current.response = {
		...current.response,
		kind: "numeric",
		value: "1.2",
		unit: "cm",
	};
	const text = exportDescription(value).join("\n");
	expect(text).toContain("12 mm（工程师人工）");
	expect(text).toContain("1.2 cm（客户回复数值）");
	expect(text).toContain("回复 R");
	expect(text).toContain("修订 2");
	expect(text).toContain("a".repeat(64));
});
it("marks replies to old geometry or diameter/radius mode as fixed old sources", () => {
	const value = snapshot(),
		item = value.document.items[0] as Annotation;
	const old = issue(item);
	value.issues = [old];
	expect(compatibleExportReply(item, old)).toBe(true);
	item.geometry = {
		type: "line",
		from: { x: 0.1, y: 0.1 },
		to: { x: 0.9, y: 0.9 },
	};
	expect(compatibleExportReply(item, old)).toBe(false);
	expect(exportDescription(value).join("\n")).toContain("不套用当前几何");
	const circle = annotation(geometries[1]);
	const diameter = issue(circle);
	circle.metadata.circleMeasure = "radius";
	expect(compatibleExportReply(circle, diameter)).toBe(false);
});
it.each(geometries)(
	"exports saved $type geometry through the existing paths",
	(geometry) => {
		const paths = geometryPaths(geometry, 800, 400, 1);
		expect(paths.length).toBeGreaterThan(0);
		expect(paths.join("")).not.toMatch(/NaN|Infinity/);
	},
);
it("preserves complete text and unicode while wrapping long hashes and line breaks", () => {
	const text = "中文🙂ABC\n第二行<>&";
	const wrapped = wrapExportText(text, (value) => Array.from(value).length, 4);
	expect(wrapped.join("")).toBe(text.replaceAll("\n", ""));
	expect(wrapped.every((line) => Array.from(line).length <= 4)).toBe(true);
});
it("bounds portrait, panorama, aggregate pixels and full descriptions without cropping", () => {
	expect(exportPhotoSize(800, 400)).toEqual({ width: 800, height: 400 });
	expect(exportPhotoSize(8000, 4000)).toEqual({ width: 4096, height: 2048 });
	expect(exportPhotoSize(4000, 8000)).toEqual({ width: 2048, height: 4096 });
	expect(() => exportCanvasSize(exportPhotoSize(4096, 4096), 10)).not.toThrow();
	expect(() => exportPhotoSize(10000, 10000)).toThrow("EXPORT_LIMIT");
	expect(() => exportCanvasSize({ width: 4096, height: 4096 }, 1)).toThrow(
		"EXPORT_LIMIT",
	);
	const value = snapshot();
	value.file.byteSize = 90 * 1024 * 1024;
	expect(() => checkExportSize(value)).toThrow("EXPORT_LIMIT");
	(value.document.items[0] as Annotation).metadata.notes = "长".repeat(60001);
	expect(() => exportDescription(value)).toThrow("EXPORT_LIMIT");
});
it("checks the actual source hash and refuses a result when final authorization is revoked", async () => {
	const value = snapshot(),
		bytes = new TextEncoder().encode("synthetic-webp");
	value.file.byteSize = bytes.length;
	value.document.items = [];
	value.document.image.imageHash = Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
	)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	const close = vi.fn(),
		decode = vi.fn(async () => ({ close }));
	const context = {
		measureText: (text: string) => ({ width: text.length * 10 }),
		fillRect: vi.fn(),
		fillText: vi.fn(),
		drawImage: vi.fn(),
		beginPath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		stroke: vi.fn(),
	};
	const canvas = {
		width: 0,
		height: 0,
		getContext: () => context,
		toBlob: (callback: (blob: Blob) => void, mime: string) =>
			callback(new Blob(["output"], { type: mime })),
	};
	vi.mocked(apiSessionGuard).mockReturnValue(vi.fn());
	vi.mocked(readApiTransport)
		.mockResolvedValueOnce(value)
		.mockRejectedValueOnce(Error("REVOKED"));
	vi.stubGlobal("document", { createElement: () => canvas });
	vi.stubGlobal("createImageBitmap", decode);
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(bytes, {
					headers: {
						"Content-Type": "image/webp",
						"X-PM-Image-Version": value.document.image.imageHash,
					},
				}),
		),
	);
	try {
		await expect(
			generateAnnotatedExport(
				"/api/guest/projects/P",
				"F",
				"png",
				new AbortController().signal,
				vi.fn(),
			),
		).rejects.toThrow("REVOKED");
		expect(readApiTransport).toHaveBeenLastCalledWith(
			"/api/guest/projects/P/image-access?ids=F",
			expect.any(AbortSignal),
		);
		expect(close).toHaveBeenCalledOnce();
		expect(canvas.width).toBe(0);
		vi.mocked(readApiTransport).mockResolvedValueOnce({
			...value,
			document: {
				...value.document,
				image: { ...value.document.image, imageHash: "b".repeat(64) },
			},
		});
		await expect(
			generateAnnotatedExport(
				"/api/guest/projects/P",
				"F",
				"png",
				new AbortController().signal,
				vi.fn(),
			),
		).rejects.toMatchObject({ code: "IMAGE_VERSION_CONFLICT" });
		expect(decode).toHaveBeenCalledOnce();
	} finally {
		vi.unstubAllGlobals();
	}
});
it("cancels immediately and releases a native result that finishes afterwards", async () => {
	const controller = new AbortController(),
		dispose = vi.fn();
	let finish!: (value: string) => void;
	const work = abortableExport(
		new Promise<string>((resolve) => {
			finish = resolve;
		}),
		controller.signal,
		dispose,
	);
	controller.abort();
	await expect(work).rejects.toMatchObject({ name: "AbortError" });
	finish("bitmap");
	await Promise.resolve();
	expect(dispose).toHaveBeenCalledWith("bitmap");
});
it.each(["png", "jpg"] as const)(
	"renders a complete sheet and encodes %s without editor controls",
	async (format) => {
		const drawImage = vi.fn(),
			stroke = vi.fn(),
			fillText = vi.fn(),
			close = vi.fn(),
			encode = vi.fn((callback: (blob: Blob) => void, mime: string) =>
				callback(new Blob(["encoded"], { type: mime })),
			);
		const context = {
			measureText: (text: string) => ({ width: text.length * 10 }),
			fillRect: vi.fn(),
			fillText,
			drawImage,
			stroke,
			save: vi.fn(),
			restore: vi.fn(),
			translate: vi.fn(),
			scale: vi.fn(),
			beginPath: vi.fn(),
			rect: vi.fn(),
			clip: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
		};
		const canvas = {
			width: 0,
			height: 0,
			getContext: () => context,
			toBlob: encode,
		};
		vi.stubGlobal("document", { createElement: () => canvas });
		vi.stubGlobal(
			"Path2D",
			class {
				constructor(public data: string) {}
			},
		);
		vi.stubGlobal(
			"createImageBitmap",
			vi.fn(async () => ({ close })),
		);
		try {
			const value = snapshot();
			value.document.items = geometries.map((geometry, index) => ({
				...annotation(geometry),
				id: `A${index}`,
			}));
			const blob = await renderAnnotatedExport(
				value,
				new Blob(["source"]),
				format,
				new AbortController().signal,
				vi.fn(),
			);
			expect(blob.type).toBe(format === "png" ? "image/png" : "image/jpeg");
			expect(drawImage).toHaveBeenCalledWith(
				expect.anything(),
				240,
				80,
				800,
				400,
			);
			expect(stroke.mock.calls.length).toBeGreaterThanOrEqual(15);
			expect(
				fillText.mock.calls.some((call) =>
					String(call[0]).includes("中文备注 <> &"),
				),
			).toBe(true);
			expect(close).toHaveBeenCalledOnce();
			expect(canvas.width).toBe(0);
		} finally {
			vi.unstubAllGlobals();
		}
	},
);
