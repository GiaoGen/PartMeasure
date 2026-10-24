import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { roundGeometry, fitDetected, configuration, type Candidate, type Detections, type PixelEllipse } from "./core";
import type { Geometry } from "../../src/lib/annotations";

const directory = new URL("../../tmp/p1-03/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8")) as { items: { id: string; category: string; width: number; height: number; canonicalSha256: string }[] };
const probes = JSON.parse(await readFile(new URL("probes.json", import.meta.url), "utf8")) as { items: { imageId: string; label: string; geometry: Geometry }[] };
const records = [];
for (const sample of manifest.items) {
	const native = JSON.parse(await readFile(new URL(`edge-drawing/${sample.id}.json`, directory), "utf8")) as { lines: Detections["lines"]; rounds: PixelEllipse[]; totalMs: number };
	// EdgeDrawing exposes no comparable per-candidate coverage/residual scores.
	// Keep their values null in evidence; do not fabricate cross-algorithm quality.
	const candidates: Candidate[] = [];
	for (const e of native.rounds) {
		if (candidates.some(c => Math.hypot(c.pixel.x - e.x, c.pixel.y - e.y) < Math.max(3, e.ry * .12) && Math.abs(Math.log(e.rx / c.pixel.rx)) < .15 && Math.abs(Math.log(e.ry / c.pixel.ry)) < .15)) continue;
		candidates.push({ geometry: roundGeometry(e, sample.width, sample.height), pixel: e, quality: 1, coverage: null, residual: null });
	}
	const selected = probes.items.filter(p => p.imageId === sample.id);
	const locals = selected.map(p => ({ label: p.label, ...fitDetected({ lines: native.lines, rounds: candidates }, p.geometry, sample.width, sample.height) }));
	const entry = { id: sample.id, category: sample.category, width: sample.width, height: sample.height, canonicalSha256: sample.canonicalSha256, configuration: "edge-drawing-pf-nfa-1", totalMs: native.totalMs,
		candidateCountBeforeLimit: candidates.length, candidates: candidates.slice(0, configuration.maxCandidates), locals,
		localFeatureScope: "Full-image EdgeDrawing extraction reused; same position/size/direction matcher. Canny/Hough recomputes ROI features, so these are not identical detectors or runtimes.",
		scoreNote: "quality=1 is a neutral matcher weight, NOT confidence. EdgeDrawing does not export coverage/residual; those values are null." };
	await writeFile(new URL(`edge-drawing/view-${sample.id}.json`, directory), JSON.stringify(entry, null, 2));
	records.push({ id: sample.id, category: sample.category, nativeComputeMs: native.totalMs, candidatesBeforeLimit: candidates.length, shownCircles: entry.candidates.filter(c => c.geometry.type === "circle").length, shownEllipses: entry.candidates.filter(c => c.geometry.type === "ellipse").length, probes: locals.map(l => ({ label: l.label, type: l.input.type, changed: l.changed, reason: l.reason })) });
}
const median = (v: number[]) => [...v].sort((a,b) => a-b)[Math.floor(v.length / 2)] ?? null;
await writeFile(new URL("edge-drawing/comparison.json", directory), JSON.stringify({ status: "human-evaluation-pending", generatedAt: new Date().toISOString(), probesSha256: createHash("sha256").update(await readFile(new URL("probes.json", import.meta.url))).digest("hex"), imageCount: records.length, nativeMedianMs: median(records.map(r => r.nativeComputeMs)), records, precision: null, recall: null, engineerTime: null, browserCost: null, phoneResponsiveness: null }, null, 2));
process.stdout.write(`Compared ${records.length} existing images; human correctness/timing pending.\n`);
