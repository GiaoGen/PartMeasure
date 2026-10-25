import { pdfLimits } from "./pdf-report";
import { AppError } from "./policy";
export type RasterPdfPage = { image: Blob; width: number; height: number };
/** Minimal PDF 1.4 container for internally generated RGB JPEG pages. No user
 * strings, scripts, attachments or external references enter PDF syntax. */
export function rasterPdf(pages: RasterPdfPage[], signal: AbortSignal): Blob {
	signal.throwIfAborted();
	if (!pages.length || pages.length > pdfLimits.pages)
		throw new AppError("PDF_LIMIT", 413);
	const parts: BlobPart[] = [],
		offsets = [0];
	let length = 0;
	const encoder = new TextEncoder();
	const append = (part: string | Blob) => {
		const value = typeof part === "string" ? encoder.encode(part) : part;
		parts.push(value);
		length += value instanceof Blob ? value.size : value.byteLength;
		if (length > pdfLimits.bytes) throw new AppError("PDF_LIMIT", 413);
	};
	const object = (id: number, body: string) => {
		offsets[id] = length;
		append(`${id} 0 obj\n${body}\nendobj\n`);
	};
	append("%PDF-1.4\n% PartMeasure raster report\n");
	object(1, "<< /Type /Catalog /Pages 2 0 R >>");
	object(
		2,
		`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${3 + index * 3} 0 R`).join(" ")}] >>`,
	);
	pages.forEach((page, index) => {
		signal.throwIfAborted();
		if (
			page.image.type !== "image/jpeg" ||
			!page.image.size ||
			!Number.isSafeInteger(page.width) ||
			!Number.isSafeInteger(page.height) ||
			page.width < 1 ||
			page.height < 1 ||
			page.width * page.height > 4_000_000
		)
			throw new AppError("PDF_LIMIT", 413);
		const id = 3 + index * 3,
			content = "q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n";
		object(
			id,
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
		);
		object(
			id + 1,
			`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`,
		);
		offsets[id + 2] = length;
		append(
			`${id + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.image.size} >>\nstream\n`,
		);
		append(page.image);
		append("\nendstream\nendobj\n");
	});
	const xref = length;
	append(
		`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
			.slice(1)
			.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
			.join(
				"",
			)}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
	);
	return new Blob(parts, { type: "application/pdf" });
}
