import { stat } from "node:fs/promises";
import sharp from "sharp";
import { limits } from "../../src/lib/policy";
const [source, target, mode] = process.argv.slice(2);
if (!source || !target) process.exit(2);
sharp.cache({ memory: 16, files: 0, items: 8 });
sharp.concurrency(1);
const timer = setInterval(() => {
	if (process.memoryUsage().rss > 1024 * 1024 * 1024) process.exit(3);
}, 100);
try {
	const image = sharp(source, {
		limitInputPixels: limits.imagePixels,
		failOn: "warning",
		pages: 1,
	});
	const meta = await image.metadata();
	if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) > 1)
		throw new Error("INVALID_IMAGE");
	// Decode once, orient before resizing. All outputs share the same coordinate frame.
	const { data, info } = await image
		.autoOrient()
		.toColourspace("srgb")
		.raw()
		.toBuffer({ resolveWithObject: true });
	const raw = { width: info.width, height: info.height, channels: info.channels };
	let total = 0;
	if (mode !== "thumbnails-only") {
		await sharp(data, { raw }).webp({ lossless: true }).toFile(target);
		total = (await stat(target)).size;
	}
	const thumbnails = [];
	for (const variant of mode === "canonical-only" ? [] : [320, 640]) {
		const output = `${target}.${variant}.webp`;
		const result = await sharp(data, { raw })
			.resize({ width: variant, height: variant, fit: "inside", withoutEnlargement: true })
			.webp({ quality: 78, effort: 3 })
			.toFile(output);
		const bytes = (await stat(output)).size;
		if (bytes > 262144) throw new Error("THUMBNAIL_LIMIT");
		total += bytes;
		thumbnails.push({ variant, width: result.width, height: result.height, bytes });
	}
	if (total > limits.derivative) throw new Error("DERIVATIVE_LIMIT");
	process.stdout.write(
		JSON.stringify({
			width: info.width,
			height: info.height,
			thumbnails,
			mime: "image/webp",
			normalizationVersion: 1,
		}),
	);
} catch {
	process.exitCode = 1;
} finally {
	clearInterval(timer);
}
