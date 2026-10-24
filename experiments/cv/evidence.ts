import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const directory = new URL("../../tmp/p1-03/", import.meta.url);
const destination = new URL("../../docs/evidence/p1-03/", import.meta.url);
const json = async (path: string) => JSON.parse(await readFile(new URL(path, directory), "utf8"));
const manifest = await json("manifest.json");
const baseline = await json("results/summary.json");
const native = await json("edge-drawing/summary.json");
const comparison = await json("edge-drawing/comparison.json");
const probeBytes = await readFile(new URL("probes.json", import.meta.url));
const probes = JSON.parse(probeBytes.toString());
if (baseline.failures.length || native.failures.length || baseline.completedImages !== manifest.items.length || comparison.imageCount !== manifest.items.length) throw Error("INCOMPLETE_BATCH");
if (comparison.probesSha256 !== createHash("sha256").update(probeBytes).digest("hex")) throw Error("STALE_PROBE_COMPARISON");
type Count = { images: number; circles: number; ellipses: number; changed: Record<string, number>; retained: Record<string, number> };
const groups: Record<string, Record<string, Count>> = { baseline: {}, edge: {} };
const imageRecords = [];
for (const sample of manifest.items) {
	const views = [];
	for (const engine of ["baseline", "edge"]) {
		const result = await json(engine === "baseline" ? `results/${sample.id}.json` : `edge-drawing/view-${sample.id}.json`);
		if (result.canonicalSha256 !== sample.canonicalSha256 || result.locals.length !== probes.items.filter((p: { imageId: string }) => p.imageId === sample.id).length) throw Error(`STALE_RESULT:${sample.id}`);
		const group = groups[engine];
		if (!group) throw Error("UNKNOWN_ENGINE");
		const count = group[sample.category] ?? { images: 0, circles: 0, ellipses: 0, changed: {}, retained: {} };
		count.images++;
		for (const candidate of result.candidates) { if (candidate.geometry.type === "circle") count.circles++; else count.ellipses++; }
		for (const local of result.locals) { const target = local.changed ? count.changed : count.retained; target[local.input.type] = (target[local.input.type] ?? 0) + 1; }
		group[sample.category] = count;
		views.push({ engine, candidates: result.candidates.map((c: { geometry: unknown }) => c.geometry), locals: result.locals, computeMs: result.totalMs });
	}
	imageRecords.push({ id: sample.id, category: sample.category, canonicalSha256: sample.canonicalSha256, views });
}
const percentile = (values: number[], p: number) => [...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length*p)-1)] ?? null;
const evidence = {
	generatedAt: new Date().toISOString(), status: "technical-experiment-complete-human-evaluation-pending",
	imageCount: manifest.items.length, probeCount: probes.items.length, groups,
	baseline: { environment: baseline.environment, configuration: baseline.configuration, initializationMs: baseline.initializationMs, artifactBytes: baseline.artifactBytes, artifactSha256: baseline.artifactSha256, timing: baseline.timing, resources: baseline.resources },
	edgeDrawing: { algorithm: native.algorithm, opencv: native.opencv, numpy: native.numpy, python: native.python, platform: native.platform, threads: native.threads, parameters: native.parameters, initializationMs: native.initializationMs, binaryBytes: native.binaryBytes, binarySha256: native.binarySha256, medianMs: percentile(native.records.map((r: { totalMs: number }) => r.totalMs), .5), p95Ms: percentile(native.records.map((r: { totalMs: number }) => r.totalMs), .95) },
	human: { precision: null, recall: null, completionTime: null, corrections: null, undoCount: null, browserInitializationMs: null, phoneResponsiveness: null },
	limitations: ["Single dataset, repeated part families, no actual user workbench/phone photos or typical solid stepped shafts", "27 analyst-positioned rough intents are not independent human ground truth", "Native full-image extraction and Node/WASM ROI fitting have different scopes/runtimes; timings are not a speed comparison", "Changed geometry is not a correctness or productivity result", "No browser/E2E or phone test has run; manual workbench is delivered for human use"],
	images: imageRecords,
};
await mkdir(destination, { recursive: true });
await writeFile(new URL("technical-results.json", destination), JSON.stringify(evidence, null, 2));
await writeFile(new URL("sources.json", destination), JSON.stringify({ ...manifest, status: "36-bounded-public-samples-used-with-generalization-limits" }, null, 2));
process.stdout.write(JSON.stringify({ imageCount: evidence.imageCount, probeCount: evidence.probeCount, groups, baseline: evidence.baseline, edgeDrawing: evidence.edgeDrawing }, null, 2));
