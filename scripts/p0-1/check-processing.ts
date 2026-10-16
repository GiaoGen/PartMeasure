import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import sharp from "sharp";
import { scan } from "../../src/lib/server/scanner";
const results: { check: string; status: string }[] = [];
sharp.cache(false);
let stage = "normalize";
const dir = await mkdtemp(path.join(tmpdir(), "partmeasure-check-"));
try {
	const manifest = JSON.parse(
		await readFile("experiments/konva/public/fixtures/manifest.json", "utf8"),
	);
	for (const sample of manifest.samples) {
		const output = path.join(dir, `${sample.id}.webp`);
		const result = await new Promise<string>((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"scripts/p0-1/image-process.ts",
					`experiments/konva/public${sample.source}`,
					output,
				],
				{ windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
			);
			let json = "";
			child.stdout.on("data", (b) => {
				json += b.toString();
			});
			child.once("error", reject);
			child.once("exit", (exit) =>
				exit === 0 ? resolve(json) : reject(new Error("PROCESS_FAILED")),
			);
		});
		const info = JSON.parse(result),
			meta = await sharp(output).metadata();
		assert.equal(info.width, sample.width);
		assert.equal(info.height, sample.height);
		assert.equal(meta.orientation, undefined);
		assert.equal(meta.exif, undefined);
		const pixels = await sharp(output).removeAlpha().raw().toBuffer();
		for (const [index, [u, v]] of [
			[0, [0.2, 0.2]],
			[1, [0.8, 0.2]],
			[2, [0.2, 0.8]],
			[3, [0.8, 0.8]],
		] as const) {
			const at =
				(Math.floor(v * sample.height) * sample.width +
					Math.floor(u * sample.width)) *
				3;
			for (let c = 0; c < 3; c++)
				assert.ok(
					Math.abs((pixels[at + c] ?? 0) - manifest.colors[index][c]) <= 10,
				);
		}
		results.push({
			check: `worker-normalization-${sample.id}`,
			status: "PASS",
		});
	}
	stage = "scanner-clean";
	const clean = path.join(dir, "clean.txt");
	await writeFile(clean, "PartMeasure scanner clean fixture");
	await scan(clean);
	results.push({ check: "real-clamav-clean", status: "PASS" });
	const eicar = path.join(dir, "eicar-test.txt");
	// Standard non-executable antivirus test string, assembled to avoid accidental source-file quarantine.
	await writeFile(
		eicar,
		[
			"X5O!P%@AP[4\\PZX54(P^)7CC)7}$",
			"EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
		].join(""),
	);
	stage = "scanner-eicar";
	let rejected = false;
	try {
		await scan(eicar);
	} catch (e) {
		rejected = (e as { code?: string }).code === "MALWARE_REJECTED";
	}
	assert.ok(rejected);
	results.push({ check: "real-clamav-eicar-rejected", status: "PASS" });
	const previous = process.env.CLAMD_HOST;
	delete process.env.CLAMD_HOST;
	let closed = false;
	try {
		await scan(clean);
	} catch (e) {
		closed = (e as { code?: string }).code === "SCANNER_NOT_CONFIGURED";
	}
	process.env.CLAMD_HOST = previous;
	assert.ok(closed);
	results.push({ check: "no-scanner-fail-closed", status: "PASS" });
} catch {
	results.push({ check: stage, status: "FAIL" });
	process.exitCode = 1;
} finally {
	await rm(dir, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 200,
	}).catch(() => {
		results.push({ check: "temporary-file-cleanup", status: "FAIL" });
		process.exitCode = 1;
	});
}
await mkdir("docs/evidence/p0-1", { recursive: true });
await writeFile(
	"docs/evidence/p0-1/processing.json",
	JSON.stringify(
		{
			checkedAt: new Date().toISOString(),
			synthetic: true,
			realPhone: false,
			results,
		},
		null,
		2,
	),
);
process.stdout.write(`${JSON.stringify(results)}\n`);
