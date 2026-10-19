// Reuses the P0-0 EXIF fixtures and the actual isolated image-processing executable.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
const out = "tmp/performance-s34/images",
	results = [];
await mkdir(out, { recursive: true });
function processImage(source, target, mode) {
	return JSON.parse(
		execFileSync(
			process.execPath,
			[
				"--max-old-space-size=512",
				"--import",
				"tsx",
				"scripts/p0-1/image-process.ts",
				source,
				target,
				...(mode ? [mode] : []),
			],
			{
				env: {
					PATH: process.env.PATH ?? "",
					SystemRoot: process.env.SystemRoot ?? "",
					TEMP: process.env.TEMP ?? "",
					NODE_ENV: "production",
				},
				timeout: 30000,
				windowsHide: true,
				stdio: ["ignore", "pipe", "ignore"],
			},
		).toString(),
	);
}
for (const name of (await readdir("experiments/konva/public/fixtures")).filter((v) =>
	v.endsWith("-source.jpg"),
)) {
	const source = `experiments/konva/public/fixtures/${name}`,
		target = `${out}/${name}.webp`;
	try {
		const meta = processImage(source, target),
			ref = await sharp(source)
				.autoOrient()
				.toColourspace("srgb")
				.raw()
				.toBuffer({ resolveWithObject: true }),
			actual = await sharp(target).raw().toBuffer({ resolveWithObject: true });
		assert.equal(meta.width, ref.info.width);
		assert.equal(meta.height, ref.info.height);
		assert.deepEqual(actual.data, ref.data);
		assert.equal((await sharp(target).metadata()).orientation, undefined);
		let bytes = (await stat(target)).size;
		for (const t of meta.thumbnails) {
			const file = `${target}.${t.variant}.webp`,
				image = await sharp(file).metadata();
			assert.ok(image.width <= t.variant && image.height <= t.variant);
			assert.ok(Math.abs(image.width / image.height - meta.width / meta.height) < 0.01);
			assert.ok((await stat(file)).size <= 262144);
			assert.equal(image.orientation, undefined);
			bytes += (await stat(file)).size;
		}
		assert.ok(bytes <= 80 * 1024 * 1024);
		const before = await readFile(target);
		processImage(target, `${target}.backfill`, "thumbnails-only");
		assert.deepEqual(await readFile(target), before);
		results.push({
			check: name,
			status: "PASS",
			scope:
				"canonical pixel equality, orientation, thumbnail aspect/budget, backfill immutability",
		});
	} catch {
		results.push({ check: name, status: "FAIL" });
	}
}
try {
	const source = `${out}/noise.jpg`,
		target = `${out}/noise.webp`;
	await sharp(randomBytes(2000 * 1500 * 3), { raw: { width: 2000, height: 1500, channels: 3 } })
		.jpeg({ quality: 92 })
		.toFile(source);
	const start = performance.now(),
		meta = processImage(source, target),
		canonicalBytes = (await stat(target)).size,
		thumbBytes = (await stat(`${target}.640.webp`)).size;
	assert.ok(meta.thumbnails.length === 2 && thumbBytes < canonicalBytes / 5);
	results.push({
		check: "3MP-entropy-image",
		status: "PASS",
		milliseconds: Math.round(performance.now() - start),
		canonicalBytes,
		thumbnailBytes: thumbBytes,
	});
	const deliveryTarget = `${out}/delivery.webp`;
	const delivery = processImage(source, deliveryTarget, "canonical-only");
	assert.equal(delivery.thumbnails.length, 0);
	assert.deepEqual(await sharp(deliveryTarget).raw().toBuffer(), await sharp(target).raw().toBuffer());
	results.push({check:"delivery-canonical-only",status:"PASS",scope:"same canonical pixels without unused thumbnails"});
} catch {
	results.push({ check: "3MP-entropy-image", status: "FAIL" });
}
await mkdir("docs/evidence/performance-s34", { recursive: true });
await writeFile(
	"docs/evidence/performance-s34/images.json",
	JSON.stringify(
		{
			environment:
				"actual isolated child process; synthetic images; no scanner/cloud/mobile claim",
			results,
		},
		null,
		2,
	),
);
console.log(JSON.stringify(results));
if (results.some((v) => v.status !== "PASS")) process.exitCode = 1;
