import sharp from "sharp";
import { stat } from "node:fs/promises";
import { limits, AppError } from "./policy";
sharp.cache({ memory: 16, files: 0, items: 8 });
sharp.concurrency(1);
export async function normalizeImage(source: string, target: string, mode = "all") {
	const image = sharp(source, { limitInputPixels: limits.imagePixels, failOn: "warning", pages: 1 }).timeout({ seconds: 20 });
	const meta = await image.metadata();
	if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) > 1)
		throw new AppError("INVALID_IMAGE", 422);
	const { data, info } = await image.autoOrient().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
	const raw = { width: info.width, height: info.height, channels: info.channels };
	let total = 0;
	if (mode !== "thumbnails-only") {
		await sharp(data, { raw }).timeout({ seconds: 20 }).webp({ lossless: true }).toFile(target);
		total = (await stat(target)).size;
	}
	const thumbnails = [];
	for (const variant of mode === "canonical-only" ? [] : [320, 640]) {
		const output = `${target}.${variant}.webp`;
		const result = await sharp(data, { raw }).timeout({ seconds: 10 })
			.resize({ width: variant, height: variant, fit: "inside", withoutEnlargement: true })
			.webp({ quality: 78, effort: 3 }).toFile(output);
		const bytes = (await stat(output)).size;
		if (bytes > 262144) throw new AppError("THUMBNAIL_LIMIT", 422);
		total += bytes;
		thumbnails.push({ variant, width: result.width, height: result.height, bytes });
	}
	if (total > limits.derivative) throw new AppError("DERIVATIVE_LIMIT", 422);
	return { width: info.width, height: info.height, thumbnails, mime: "image/webp", normalizationVersion: 1 };
}
