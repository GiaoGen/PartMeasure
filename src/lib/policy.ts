import { z } from "zod";

export const MiB = 1024 * 1024;
export const limits = {
	project: 1024 * MiB,
	account: 5 * 1024 * MiB,
	daily: 500 * MiB,
	derivative: 80 * MiB,
	batch: 20,
	imagePixels: 40_000_000,
};
export const extensions = [
	"jpg",
	"jpeg",
	"png",
	"webp",
	"pdf",
	"step",
	"stp",
	"sldprt",
	"sldasm",
	"stl",
	"dxf",
	"dwg",
	"zip",
] as const;
export const imageExtensions = new Set(["jpg", "jpeg", "png", "webp"]);
export const projectInput = z
	.object({
		name: z.string().trim().min(1).max(120),
		description: z.string().max(4000).default(""),
	})
	.strict();
// Existing PATCH semantics stay unchanged; classification is set on creation.
export const projectCreateInput = projectInput.extend({
	folderId: z.uuid().nullable().optional(),
});
export const uploadInput = z
	.object({
		filename: z
			.string()
			.min(1)
			.max(255)
			.refine(
				(s) =>
					!Array.from(s).some(
						(c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
					) &&
					!/[/\\]|\.(exe|com|bat|cmd|ps1|js|vbs)\./i.test(s) &&
					Buffer.byteLength(s, "utf8") <= 255,
			),
		byteSize: z
			.number()
			.int()
			.positive()
			.max(100 * MiB),
		declaredMime: z.string().max(120),
		sha256: z.string().regex(/^[0-9a-f]{64}$/),
		purpose: z.enum(["material", "delivery"]).optional(),
	})
	.strict();
export class AppError extends Error {
	constructor(
		public code: string,
		public status = 400,
	) {
		super(code);
	}
}
export const declaredMimeTypes: Readonly<Record<string, readonly string[]>> = {
	jpg: ["image/jpeg"],
	jpeg: ["image/jpeg"],
	png: ["image/png"],
	webp: ["image/webp"],
	pdf: ["application/pdf"],
};
export function formatFileLimit(ext: string) {
	return imageExtensions.has(ext)
		? 20 * MiB
		: ext === "pdf"
			? 50 * MiB
			: 100 * MiB;
}
export function uploadPolicyDto(maxFileBytes: number) {
	return {
		version: 1,
		maxFileBytes,
		formats: extensions.map((extension) => ({
			extension,
			maxFileBytes: Math.min(formatFileLimit(extension), maxFileBytes),
			declaredMimeTypes: declaredMimeTypes[extension] ?? null,
		})),
		maxBatchFiles: limits.batch,
		maxImagePixels: limits.imagePixels,
		budgets: {
			projectBytes: limits.project,
			accountBytes: limits.account,
			dailySourceBytes: limits.daily,
			imageDerivativeReserveBytes: limits.derivative,
		},
		transport: { tusThresholdBytes: 6 * MiB, tusChunkBytes: 6 * MiB },
		processing: {
			required: true,
			imageFormat: "image/webp",
			normalizationVersion: 1,
		},
	};
}
export function uploadPolicy(filename: string, bytes: number, mime: string) {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	if (!extensions.includes(ext as (typeof extensions)[number]))
		throw new AppError("UNSUPPORTED_FORMAT", 415);
	const max = formatFileLimit(ext);
	if (bytes > max) throw new AppError("FILE_TOO_LARGE", 413);
	const known = declaredMimeTypes;
	if (known[ext] && mime && !known[ext]?.includes(mime))
		throw new AppError("MIME_MISMATCH", 415);
	return {
		ext,
		image: imageExtensions.has(ext),
		budget: bytes + (imageExtensions.has(ext) ? limits.derivative : 0),
	};
}
export function sniff(bytes: Buffer, ext: string) {
	const ascii = bytes.subarray(0, 8192).toString("latin1");
	const hex = bytes.subarray(0, 8).toString("hex");
	const ok =
		ext === "jpg" || ext === "jpeg"
			? hex.startsWith("ffd8ff")
			: ext === "png"
				? hex === "89504e470d0a1a0a"
				: ext === "webp"
					? ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP"
					: ext === "pdf"
						? ascii.startsWith("%PDF-")
						: ext === "step" || ext === "stp"
							? /^\s*ISO-10303-21;/.test(ascii)
							: ext === "sldprt" || ext === "sldasm"
								? hex === "d0cf11e0a1b11ae1"
								: ext === "dwg"
									? /^AC10[0-9]{2}/.test(ascii)
									: ext === "dxf"
										? ascii.startsWith(
												`AutoCAD Binary DXF\r\n${String.fromCharCode(26, 0)}`,
											) || /^\s*0\s+SECTION\s+2\s+(HEADER|ENTITIES)/.test(ascii)
										: ext === "stl"
											? (/^\s*solid\b/.test(ascii) &&
													/facet\s+normal/.test(ascii)) ||
												(bytes.length >= 84 &&
													84 + bytes.readUInt32LE(80) * 50 === bytes.length)
											: ext === "zip"
												? hex.startsWith("504b0304")
												: false;
	if (!ok) throw new AppError("MAGIC_MISMATCH", 422);
	if (ext === "zip") validateZip(bytes);
}
// Bounded central-directory inspection; never extract. ClamAV still scans all allowed content.
export function validateZip(bytes: Buffer) {
	const end = bytes.lastIndexOf(Buffer.from("504b0506", "hex"));
	if (
		end < 0 ||
		end + 22 > bytes.length ||
		bytes.readUInt16LE(end + 4) !== 0 ||
		bytes.readUInt16LE(end + 6) !== 0
	)
		throw new AppError("ZIP_MULTIVOLUME", 422);
	const count = bytes.readUInt16LE(end + 10),
		size = bytes.readUInt32LE(end + 12),
		start = bytes.readUInt32LE(end + 16);
	if (count > 1000 || start + size > end || count === 65535)
		throw new AppError("ZIP_LIMIT", 422);
	let offset = start,
		expanded = 0;
	for (let i = 0; i < count; i++) {
		if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
			throw new AppError("ZIP_INVALID", 422);
		const flags = bytes.readUInt16LE(offset + 8),
			method = bytes.readUInt16LE(offset + 10),
			packed = bytes.readUInt32LE(offset + 20),
			unpacked = bytes.readUInt32LE(offset + 24);
		const nameLen = bytes.readUInt16LE(offset + 28),
			extraLen = bytes.readUInt16LE(offset + 30),
			commentLen = bytes.readUInt16LE(offset + 32);
		const name = bytes
			.subarray(offset + 46, offset + 46 + nameLen)
			.toString("utf8");
		expanded += unpacked;
		if (
			flags & 1 ||
			![0, 8].includes(method) ||
			bytes.readUInt16LE(offset + 34) !== 0 ||
			expanded > 200 * MiB ||
			unpacked > Math.max(packed, 1) * 100 ||
			/(^|[\\/])\.\.([\\/]|$)|^[\\/]|:/.test(name) ||
			/\.(exe|dll|com|bat|cmd|ps1|js|vbs|scr|msi)$/i.test(name)
		)
			throw new AppError("ZIP_UNSAFE", 422);
		offset += 46 + nameLen + extraLen + commentLen;
	}
	if (offset !== start + size) throw new AppError("ZIP_INVALID", 422);
}
