import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Geometry } from "../../src/lib/annotations";
import { analyze, configuration, type LocalResult } from "./core";
import { loadCv } from "./runtime";

type Sample = { id: string; category: string; canonicalPath: string; canonicalSha256: string; width: number; height: number };
const directory = new URL("../../tmp/p1-03/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8")) as { items: Sample[]; originalSource: string; mirrorRevision: string };
const probes = JSON.parse(await readFile(new URL("probes.json", import.meta.url), "utf8")) as { items: { imageId: string; label: string; geometry: Geometry }[] };
const { cv, initializationMs } = await loadCv();
process.stdout.write(`OpenCV ready in ${initializationMs.toFixed(1)}ms\n`);
await mkdir(new URL("results/", directory), { recursive: true });
type Entry = Omit<ReturnType<typeof analyze>, "locals"> & {
	id: string; category: string; canonicalSha256: string; decodeMs: number;
	locals: (LocalResult & { label: string | undefined })[];
};
const results: Entry[] = [];
const failures: { id: string; reason: string }[] = [];
const rssBefore = process.memoryUsage().rss;
for (const sample of manifest.items) {
	try {
		const path = new URL(sample.canonicalPath, directory), bytes = await readFile(path);
		if (createHash("sha256").update(bytes).digest("hex") !== sample.canonicalSha256) throw Error("SAMPLE_HASH_MISMATCH");
		const decodeStarted = performance.now();
		const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
		const decodeMs = performance.now() - decodeStarted;
		const selected = probes.items.filter(item => item.imageId === sample.id);
		const draftSnapshot = JSON.stringify(selected);
		const result = analyze(cv, data, info.width, info.height, selected.map(item => item.geometry));
		if (JSON.stringify(selected) !== draftSnapshot) throw Error("PROBE_MUTATED");
		const entry = { id: sample.id, category: sample.category, canonicalSha256: sample.canonicalSha256, decodeMs, ...result,
			locals: result.locals.map((local, index) => ({ label: selected[index]?.label, ...local })) };
		await writeFile(new URL(`results/${sample.id}.json`, directory), JSON.stringify(entry, null, 2));
		results.push(entry);
		process.stdout.write(`${results.length}/${manifest.items.length} ${sample.id}: ${result.candidates.length} round candidates; ${result.totalMs.toFixed(1)}ms\n`);
	} catch (error) {
		failures.push({ id: sample.id, reason: error instanceof Error ? error.message : "UNKNOWN" });
		process.stdout.write(`FAIL ${sample.id}\n`);
	}
}
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] ?? null;
const packageJs = new URL("node_modules/@techstark/opencv-js/dist/opencv.js", import.meta.url);
const summary = {
	status: "technical-observations-human-evaluation-pending", generatedAt: new Date().toISOString(), configuration,
	source: manifest.originalSource, mirrorRevision: manifest.mirrorRevision,
	environment: { node: process.version, platform: process.platform, architecture: process.arch, cvVersion: String(cv.getBuildInformation()).split("\n").find(line => line.includes("General configuration"))?.trim() },
	initializationMs, artifactBytes: (await stat(packageJs)).size, artifactSha256: createHash("sha256").update(await readFile(packageJs)).digest("hex"),
	imageCount: manifest.items.length, completedImages: results.length, failures,
	timing: { label: "Node CPU wall time; not browser load, user completion time or phone response", totalMedianMs: percentile(results.map(item => item.totalMs), 0.5), totalP95Ms: percentile(results.map(item => item.totalMs), 0.95), preprocessingMedianMs: percentile(results.map(item => item.preprocessMs), 0.5), candidateMedianMs: percentile(results.map(item => item.candidateMs), 0.5) },
	resources: { rssBeforeBytes: rssBefore, rssAfterBytes: process.memoryUsage().rss, wasmHeapCapacityBytes: cv.HEAPU8?.byteLength ?? null, note: "RSS includes Node, Sharp and CV; endpoints are not peak memory; WASM capacity is not live allocations." },
	categoryCounts: Object.fromEntries([...new Set(results.map(item => item.category))].map(category => [category, { images: results.filter(item => item.category === category).length, circles: results.filter(item => item.category === category).reduce((n, item) => n + item.candidates.filter(c => c.geometry.type === "circle").length, 0), ellipses: results.filter(item => item.category === category).reduce((n, item) => n + item.candidates.filter(c => c.geometry.type === "ellipse").length, 0) }])),
	probes: results.flatMap(item => item.locals.map(local => ({ imageId: item.id, ...local }))),
	precision: null, recall: null, engineerCompletionTime: null, phoneResponsiveness: null,
	limitations: ["Single dataset; repeated part families and restricted backgrounds", "Algorithm candidates are not hole identities or ground truth", "Analyst rough drafts are technical probes, not recorded manual operations", "No browser, phone, human acceptance or human timing session has run"],
};
await writeFile(new URL("results/summary.json", directory), JSON.stringify(summary, null, 2));
process.stdout.write(`Summary: ${fileURLToPath(new URL("results/summary.json", directory))}\n`);
if (failures.length) process.exitCode = 1;
