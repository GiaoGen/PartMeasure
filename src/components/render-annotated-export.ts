import {
	exportCanvasSize,
	exportDescription,
	exportLimits,
	exportPhotoSize,
	type AnnotatedExport,
} from "@/lib/annotated-export";
import {
	annotationColor,
	geometryPaths,
	labelPosition,
	photoDimensionText,
	photoStatusText,
} from "@/lib/annotation-presentation";
import { AppError } from "@/lib/policy";
import { ImageTransfers } from "./image-transfers";
import { ApiError, readApiTransport, apiSessionGuard } from "./api";
import { rangeBytes } from "./download-budget";
import type { ImageAccess } from "@/lib/image-access";

export async function authorizeExportPhotos(
	base: string,
	photos: AnnotatedExport[],
	signal: AbortSignal,
) {
	const access = await readApiTransport<ImageAccess>(
		`${base}/image-access?ids=${photos.map((photo) => photo.file.id).join(",")}`,
		signal,
	);
	if (
		!photos.every((photo) =>
			access.items.some(
				(file) =>
					file.id === photo.file.id &&
					file.images.some(
						(image) =>
							image.variant === null &&
							image.version === photo.document.image.imageHash,
					),
			),
		)
	)
		throw new ApiError("NOT_FOUND", 404);
}

// One bounded export per tab; queued exports would retain private snapshots.
const exports = new ImageTransfers(1, 0);
let nativeOperations = 0;
export function nativeResult<T>(
	work: Promise<T>,
	signal: AbortSignal,
	disposeLate?: (value: T) => void,
) {
	nativeOperations++;
	const settled = work.then(
		(value) => {
			nativeOperations--;
			return value;
		},
		(error) => {
			nativeOperations--;
			throw error;
		},
	);
	return abortableExport(settled, signal, disposeLate);
}
export const exportFont =
	'"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
const font = exportFont;
export function runExport<T>(signal: AbortSignal, work: () => Promise<T>) {
	return exports.run(signal, () => {
		if (nativeOperations) throw new AppError("EXPORT_BUSY", 409);
		return work();
	});
}
export function abortableExport<T>(
	work: Promise<T>,
	signal: AbortSignal,
	disposeLate?: (value: T) => void,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason);
		if (signal.aborted) reject(signal.reason);
		else signal.addEventListener("abort", abort, { once: true });
		work.then(
			(value) => {
				signal.removeEventListener("abort", abort);
				if (signal.aborted) disposeLate?.(value);
				else resolve(value);
			},
			(error) => {
				signal.removeEventListener("abort", abort);
				reject(error);
			},
		);
	});
}
export const breathe = async (signal: AbortSignal) => {
	await abortableExport(
		new Promise<void>((resolve) => setTimeout(resolve, 0)),
		signal,
	);
	signal.throwIfAborted();
};
export function wrapExportText(
	text: string,
	measure: (value: string) => number,
	width: number,
): string[] {
	const result: string[] = [];
	const clean = Array.from(text, (character) =>
		character === "\n" ||
		(character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
			? character
			: " ",
	).join("");
	for (const paragraph of clean.split("\n")) {
		let line = "";
		for (const character of paragraph) {
			if (line && measure(line + character) > width) {
				result.push(line);
				line = "";
			}
			line += character;
		}
		result.push(line);
	}
	return result;
}
function shortened(
	text: string,
	measure: (value: string) => number,
	max: number,
) {
	const characters = Array.from(text);
	while (characters.length && measure(characters.join("")) > max)
		characters.pop();
	return characters.length === Array.from(text).length
		? text
		: `${characters.join("")}…`;
}
export async function decodePhoto(
	blob: Blob,
	size: { width: number; height: number },
	signal: AbortSignal,
) {
	if (typeof createImageBitmap === "function") {
		const bitmap = await nativeResult(
			createImageBitmap(blob, {
				resizeWidth: size.width,
				resizeHeight: size.height,
				resizeQuality: "high",
			}),
			signal,
			(image) => image.close(),
		);
		return { image: bitmap, release: () => bitmap.close() };
	}
	const url = URL.createObjectURL(blob),
		image = new Image();
	image.src = url;
	try {
		await nativeResult(image.decode(), signal);
		return {
			image,
			release: () => {
				image.src = "";
				URL.revokeObjectURL(url);
			},
		};
	} catch (error) {
		image.src = "";
		URL.revokeObjectURL(url);
		throw error;
	}
}
/** Full canonical image, never a capture of the editor viewport. */
export async function renderAnnotatedExport(
	snapshot: AnnotatedExport,
	blob: Blob,
	format: "png" | "jpg",
	signal: AbortSignal,
	progress: (value: string) => void,
) {
	const photo = exportPhotoSize(
		snapshot.document.image.width,
		snapshot.document.image.height,
	);
	const canvas = document.createElement("canvas");
	let decoded: Awaited<ReturnType<typeof decodePhoto>> | undefined;
	try {
		const context = canvas.getContext("2d");
		if (!context) throw new Error("EXPORT_CANVAS");
		context.font = `18px ${font}`;
		const width = Math.max(1280, photo.width + 48),
			lines: string[] = [];
		for (const [index, text] of exportDescription(snapshot).entries()) {
			lines.push(
				...wrapExportText(
					text,
					(value) => context.measureText(value).width,
					width - 48,
				),
			);
			if (index % 20 === 0) await breathe(signal);
		}
		const size = exportCanvasSize(photo, lines.length);
		// Conservative application buffer bound; native browser/GC allocations are additional.
		if (
			snapshot.file.byteSize * 2 +
				snapshot.document.image.width * snapshot.document.image.height * 4 +
				size.width * size.height * 8 >
			exportLimits.memory
		)
			throw new AppError("EXPORT_LIMIT", 413);
		canvas.width = size.width;
		canvas.height = size.height;
		context.fillStyle = "#ffffff";
		context.fillRect(0, 0, size.width, size.height);
		context.font = `600 22px ${font}`;
		context.fillStyle = "#202833";
		context.fillText(
			shortened(
				`${snapshot.project.name} / ${snapshot.file.filename}`,
				(value) => context.measureText(value).width,
				width - 64,
			),
			24,
			34,
		);
		context.font = `16px ${font}`;
		context.fillStyle = "#475467";
		context.fillText(
			"当前已保存标准图与标注 · 数值来源及状态见下方说明",
			24,
			63,
		);
		progress("读取并绘制完整图片…");
		decoded = await decodePhoto(blob, photo, signal);
		signal.throwIfAborted();
		const x = Math.floor((width - photo.width) / 2),
			y = 80;
		context.drawImage(decoded.image, x, y, photo.width, photo.height);
		decoded.release();
		decoded = undefined;
		await drawExportAnnotations(context, snapshot, { x, y, ...photo }, signal);
		progress("绘制数值来源与状态…");
		context.strokeStyle = "#d0d5dd";
		context.lineWidth = 1;
		context.beginPath();
		context.moveTo(24, y + photo.height + 16);
		context.lineTo(width - 24, y + photo.height + 16);
		context.stroke();
		context.font = `18px ${font}`;
		context.fillStyle = "#202833";
		for (const [index, line] of lines.entries()) {
			context.fillText(line, 24, photo.height + 124 + index * 28);
			if (index % 40 === 0) await breathe(signal);
		}
		progress("生成图片…");
		const mime = format === "png" ? "image/png" : "image/jpeg";
		const output = await nativeResult(
			new Promise<Blob>((resolve, reject) =>
				canvas.toBlob(
					(value) =>
						value && value.type === mime
							? resolve(value)
							: reject(new Error("EXPORT_ENCODING")),
					mime,
					0.92,
				),
			),
			signal,
		);
		if (output.size > 80 * 1024 * 1024) throw new AppError("EXPORT_LIMIT", 413);
		return output;
	} finally {
		decoded?.release();
		canvas.width = 0;
		canvas.height = 0;
	}
}
export async function generateAnnotatedExport(
	base: string,
	fileId: string,
	format: "png" | "jpg",
	signal: AbortSignal,
	progress: (value: string) => void,
) {
	return exports.run(signal, async () => {
		if (nativeOperations) throw new AppError("EXPORT_BUSY", 409);
		const ensureSession = apiSessionGuard();
		progress("固定已保存图片与标注…");
		const snapshot = await readApiTransport<AnnotatedExport>(
			`${base}/files/${fileId}/annotated-export`,
			signal,
		);
		ensureSession();
		signal.throwIfAborted();
		progress("读取标准图…");
		const source = await readExportPhoto(base, snapshot, signal);
		const blob = await renderAnnotatedExport(
			snapshot,
			source,
			format,
			signal,
			progress,
		);
		progress("检查下载权限…");
		// Fresh authorization after generation, including when the image bytes were already read.
		await authorizeExportPhotos(base, [snapshot], signal);
		ensureSession();
		signal.throwIfAborted();
		return {
			blob,
			filename: `${snapshot.file.filename.replace(/\.[^.]+$/, "")}-标注-${snapshot.snapshotId.slice(0, 8)}.${format}`,
		};
	});
}

export async function drawExportAnnotations(
	context: CanvasRenderingContext2D,
	snapshot: AnnotatedExport,
	box: { x: number; y: number; width: number; height: number },
	signal: AbortSignal,
) {
	const { x, y, ...photo } = box;
	const scale = photo.width / snapshot.document.image.width;
	for (const [index, item] of snapshot.document.items.entries()) {
		context.save();
		context.translate(x, y);
		context.beginPath();
		context.rect(0, 0, photo.width, photo.height);
		context.clip();
		context.scale(scale, scale);
		const paths = geometryPaths(
			item.geometry,
			snapshot.document.image.width,
			snapshot.document.image.height,
			scale,
		);
		for (const path of paths) {
			const shape = new Path2D(path);
			context.strokeStyle = "#ffffff";
			context.lineWidth = 5 / scale;
			context.stroke(shape);
			context.strokeStyle = annotationColor(item);
			context.lineWidth = 2.5 / scale;
			context.stroke(shape);
		}
		context.restore();
		const at = labelPosition(
			item.geometry,
			snapshot.document.image.width,
			snapshot.document.image.height,
			scale,
		);
		const text =
			`${index + 1} ${item.geometry.type === "text" ? item.geometry.text : photoDimensionText(item)} ${photoStatusText(item)}`.trim();
		context.font = `600 18px ${font}`;
		const label = shortened(
			text,
			(value) => context.measureText(value).width,
			Math.max(12, photo.width - 24),
		);
		const labelWidth = Math.min(
			photo.width,
			context.measureText(label).width + 12,
		);
		const lx =
				x + Math.max(0, Math.min(photo.width - labelWidth, at.x * scale)),
			ly =
				y + Math.max(0, Math.min(Math.max(0, photo.height - 28), at.y * scale));
		context.fillStyle = "#ffffff";
		context.fillRect(lx, ly, labelWidth, 28);
		context.fillStyle = "#202833";
		context.fillText(label, lx + 6, ly + 20);
		if (index % 10 === 0) await breathe(signal);
	}
}

export async function readExportPhoto(
	base: string,
	snapshot: AnnotatedExport,
	signal: AbortSignal,
) {
	const fileId = snapshot.file.id,
		ensureSession = apiSessionGuard();
	const response = await fetch(`${base}/files/${fileId}/preview`, {
		cache: "no-store",
		signal,
	});
	if (!response.ok) {
		let code = "DEPENDENCY_UNAVAILABLE";
		try {
			code = (await response.json()).error.code;
		} catch {}
		throw new ApiError(code, response.status);
	}
	if (
		response.headers.get("content-type")?.split(";")[0] !== "image/webp" ||
		response.headers.get("x-pm-image-version") !==
			snapshot.document.image.imageHash
	) {
		await response.body?.cancel();
		throw new ApiError("IMAGE_VERSION_CONFLICT", 409);
	}
	const bytes = await rangeBytes(
		response,
		snapshot.file.byteSize,
		signal,
		() => {},
	);
	const hash = Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
	)
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("");
	if (hash !== snapshot.document.image.imageHash)
		throw new ApiError("IMAGE_VERSION_CONFLICT", 409);
	ensureSession();
	signal.throwIfAborted();
	return new Blob([bytes], { type: "image/webp" });
}
