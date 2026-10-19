import { stat } from "node:fs/promises";
import sharp from "sharp";
import { limits } from "../../src/lib/policy";
const [source, target] = process.argv.slice(2);
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
	if (
		!["jpeg", "png", "webp"].includes(meta.format ?? "") ||
		(meta.pages ?? 1) > 1
	)
		throw new Error("INVALID_IMAGE");
	const result = await image
		.autoOrient()
		.toColourspace("srgb")
		.webp({ lossless: true })
		.toFile(target);
	if ((await stat(target)).size > limits.derivative)
		throw new Error("DERIVATIVE_LIMIT");
	process.stdout.write(
		JSON.stringify({
			width: result.width,
			height: result.height,
			mime: "image/webp",
			normalizationVersion: 1,
		}),
	);
} catch {
	process.exitCode = 1;
} finally {
	clearInterval(timer);
}
