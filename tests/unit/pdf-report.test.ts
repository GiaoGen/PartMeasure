import { expect, it, vi } from "vitest";
import { samplePdfReport } from "../fixtures/pdf-report";
import {
	checkPdfReport,
	pdfPhotoBlocks,
	pdfSelectionSchema,
} from "../../src/lib/pdf-report";
import { rasterPdf } from "../../src/lib/raster-pdf";
import {
	generatePdfReport,
	planPdfPages,
} from "../../src/components/render-pdf-report";
vi.mock("../../src/components/api", async (original) => ({
	...(await original<object>()),
	apiSessionGuard: vi.fn(() => vi.fn()),
	readApiTransport: vi.fn(),
}));
import { readApiTransport } from "../../src/components/api";
const measure = (text: string) => Array.from(text).length * 15;
it("accepts only 1–8 distinct image IDs and rejects extra client draft input", () => {
	const id = "00000000-0000-4000-8000-000000000001";
	expect(pdfSelectionSchema.safeParse({ fileIds: [id] }).success).toBe(true);
	for (const input of [
		{ fileIds: [] },
		{ fileIds: [id, id] },
		{ fileIds: ["x"] },
		{ fileIds: [id], draft: true },
	])
		expect(pdfSelectionSchema.safeParse(input).success).toBe(false);
});
it("starts each selected full photo on a fresh page and keeps all wrapped text in order", () => {
	const report = samplePdfReport(),
		pages = planPdfPages(report, measure);
	expect(
		pages.filter((page) => page.photo).map((page) => page.photoIndex),
	).toEqual([0, 1]);
	expect(
		pages.some((page) => page.blocks.some((block) => block.continued)),
	).toBe(true);
	expect(
		pages
			.flatMap((page) => page.blocks.flatMap((block) => block.lines))
			.join(""),
	).toContain("END-完整保留");
	for (const [index, photo] of report.photos.entries()) {
		const expected = pdfPhotoBlocks(report, photo)
			.flatMap((block) => block.lines)
			.join("")
			.replaceAll("\n", "");
		const actual = pages
			.filter((page) => page.photoIndex === index)
			.flatMap((page) => page.blocks.flatMap((block) => block.lines))
			.join("");
		expect(actual).toBe(expected);
	}
	for (const page of pages)
		for (const block of page.blocks)
			expect(
				block.y +
					(Math.ceil(measure(block.title) / 714) + block.lines.length) * 23 +
					8,
			).toBeLessThanOrEqual(1060);
});
it("retains engineering values, old revision sources, unable and remeasure records distinctly", () => {
	const report = samplePdfReport(),
		photo = report.photos[0];
	if (!photo) throw Error("FIXTURE");
	const text = pdfPhotoBlocks(report, photo)
		.flatMap((block) => block.lines)
		.join("\n");
	expect(text).toContain("125.6 mm（工程师人工）");
	expect(text).toContain("125.5 mm（人工回复数值）");
	expect(text).toContain("工程师要求补测");
	expect(text).toContain("无法测量，无数值");
	expect(text).toContain("不替代当前工程字段或当前几何");
	expect(text).toContain("记录 R1");
});
it("rejects too many records and pages rather than silently dropping the end", () => {
	const report = samplePdfReport(),
		history = report.history[0];
	if (!history) throw Error("FIXTURE");
	report.history = Array.from({ length: 2001 }, () => history);
	expect(() => checkPdfReport(report)).toThrow("PDF_LIMIT");
	report.history = [];
	expect(() => planPdfPages(report, (text) => text.length * 1000)).toThrow(
		"PDF_LIMIT",
	);
});
it("writes exact binary xref offsets and image lengths, with bounded pages", async () => {
	const bytes = new Uint8Array([255, 216, 0, 128, 255, 217]);
	const pdf = rasterPdf(
		[
			{
				image: new Blob([bytes], { type: "image/jpeg" }),
				width: 1588,
				height: 2246,
			},
		],
		new AbortController().signal,
	);
	const data = new Uint8Array(await pdf.arrayBuffer()),
		text = new TextDecoder("latin1").decode(data);
	expect(text.startsWith("%PDF-1.4")).toBe(true);
	expect(text).toContain("/MediaBox [0 0 595.28 841.89]");
	expect(text).toContain("/Length 6");
	const offset = Number(text.match(/startxref\n(\d+)/)?.[1]);
	expect(text.slice(offset, offset + 4)).toBe("xref");
	for (const match of text.matchAll(/(\d{10}) 00000 n /g))
		expect(text.slice(Number(match[1]))).toMatch(/^\d+ 0 obj/);
	expect(() => rasterPdf([], new AbortController().signal)).toThrow(
		"PDF_LIMIT",
	);
	const abort = new AbortController();
	abort.abort();
	expect(() => rasterPdf([], abort.signal)).toThrow();
});
it("withholds the whole report if final access loses any selected photo", async () => {
	const report = samplePdfReport(),
		bytes = new TextEncoder().encode("synthetic-standard-image");
	const hash = Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
	)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	for (const photo of report.photos) {
		photo.document.items = [];
		photo.document.image.imageHash = hash;
		photo.file.byteSize = bytes.length;
	}
	report.history = [];
	vi.mocked(readApiTransport)
		.mockResolvedValueOnce(report)
		.mockResolvedValueOnce({
			items: [{ id: "F1", images: [{ variant: null, version: hash }] }],
		});
	const context = {
		measureText: (text: string) => ({ width: text.length * 8 }),
		scale: vi.fn(),
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
			callback(new Blob(["jpg"], { type: mime })),
	};
	vi.stubGlobal("document", { createElement: () => canvas });
	vi.stubGlobal(
		"createImageBitmap",
		vi.fn(async () => ({ close: vi.fn() })),
	);
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(bytes, {
					headers: { "Content-Type": "image/webp", "X-PM-Image-Version": hash },
				}),
		),
	);
	try {
		await expect(
			generatePdfReport(
				"/api/guest/projects/P",
				["F1", "F2"],
				new AbortController().signal,
				vi.fn(),
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(readApiTransport).toHaveBeenLastCalledWith(
			"/api/guest/projects/P/image-access?ids=F1,F2",
			expect.any(AbortSignal),
		);
		expect(canvas.width).toBe(0);
	} finally {
		vi.unstubAllGlobals();
	}
});
