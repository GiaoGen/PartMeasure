import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import type { Geometry, Point } from "../../src/lib/annotations";
import { emptyMetadata, validateAnnotation } from "../../src/lib/annotations";
import { analyze, fitDetected, roundGeometry, type Candidate, type Detections, type PixelEllipse } from "./core";
import { contourError, percentile } from "./metrics";
import { loadCv } from "./runtime";

type Reference = { id: string; imageId: string; label: string; type: "line" | "angle" | "circle" | "ellipse"; from?: number[]; to?: number[]; vertex?: number[]; center?: number[]; radii?: number[]; angleDeg?: number; uncertaintyPx: number; semantic?: string };
type Sample = { id: string; category: string; canonicalPath: string; canonicalSha256: string; width: number; height: number };
type StoredResult = { candidates: Candidate[]; locals: { input: Geometry; output: Geometry }[] };
type Audit = { method: string; snapshotSha256: string; images: { imageId: string; baseline: string[]; edge: string[]; note: string }[] };
const root = new URL("../../tmp/p1-03/", import.meta.url);
const destination = new URL("../../docs/evidence/p1-03/", import.meta.url);
const digest = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(new URL(path, root), "utf8"));
const manifest = await json<{ items: Sample[] }>("manifest.json");
const refBytes = await readFile(new URL("references.json", import.meta.url));
const refs = JSON.parse(refBytes.toString()) as { version: string; targets: Reference[] };
const auditBytes = await readFile(new URL("candidate-audit.json", import.meta.url));
const audit = JSON.parse(auditBytes.toString()) as Audit;
const snapshotBytes = await readFile(new URL("review/snapshot.json", root));
const snapshot = JSON.parse(snapshotBytes.toString()) as { imageId: string; engine: string; resultSha256: string; count: number }[];
if (digest(snapshotBytes) !== audit.snapshotSha256) throw Error("STALE_CANDIDATE_REVIEW");
if (new Set(refs.targets.map(t => t.id)).size !== refs.targets.length) throw Error("DUPLICATE_TARGET_ID");
if (new Set(audit.images.map(t => t.imageId)).size !== manifest.items.length || audit.images.length !== manifest.items.length) throw Error("INCOMPLETE_REVIEW");

function geometry(r: Reference, w: number, h: number): Geometry {
	const p = (a: number[] | undefined): Point => { if (a?.length !== 2) throw Error(`INVALID_REFERENCE:${r.id}`); return { x: (a[0] ?? 0) / w, y: (a[1] ?? 0) / h }; };
	if (r.type === "line") return { type: "line", from: p(r.from), to: p(r.to) };
	if (r.type === "angle") return { type: "angle", from: p(r.from), vertex: p(r.vertex), to: p(r.to), reflex: false };
	if (!r.center || !r.radii) throw Error("MISSING_ROUND_REFERENCE");
	const rx = r.radii[0] ?? 0, ry = r.radii[1] ?? 0, c = p(r.center), theta = (r.angleDeg ?? 0) * Math.PI / 180;
	if (r.type === "circle") return { type: "circle", center: c, radiusX: rx / w, radiusY: rx / h };
	return { type: "ellipse", center: c, axisA: { x: c.x + rx * Math.cos(theta) / w, y: c.y + rx * Math.sin(theta) / h }, axisB: { x: c.x - ry * Math.sin(theta) / w, y: c.y + ry * Math.cos(theta) / h } };
}
function perturb(g: Geometry, w: number, h: number, dx: number, dy: number, scale: number, rotation: number): Geometry {
	if (g.type !== "line" && g.type !== "angle" && g.type !== "circle" && g.type !== "ellipse") throw Error("INVALID_TRIAL_TYPE");
	const c = g.type === "line" ? { x: (g.from.x + g.to.x) / 2, y: (g.from.y + g.to.y) / 2 } : g.type === "angle" ? g.vertex : g.center;
	const theta = rotation * Math.PI / 180, cos = Math.cos(theta), sin = Math.sin(theta);
	const p = (q: Point): Point => {
		const x = (q.x - c.x) * w * scale, y = (q.y - c.y) * h * scale;
		return { x: c.x + (x * cos - y * sin + dx) / w, y: c.y + (x * sin + y * cos + dy) / h };
	};
	if (g.type === "line") return { ...g, from: p(g.from), to: p(g.to) };
	if (g.type === "angle") return { ...g, from: p(g.from), vertex: p(g.vertex), to: p(g.to) };
	if (g.type === "circle") return { ...g, center: p(g.center), radiusX: g.radiusX * scale, radiusY: g.radiusY * scale };
	return { ...g, center: p(g.center), axisA: p(g.axisA), axisB: p(g.axisB) };
}
function nativeDetections(raw: { lines: Detections["lines"]; rounds: PixelEllipse[] }, w: number, h: number): Detections {
	const rounds: Candidate[] = [];
	// Same de-duplication as compare.ts, BEFORE the displayed candidate cap.
	for (const e of raw.rounds) {
		if (rounds.some(c => Math.hypot(c.pixel.x - e.x, c.pixel.y - e.y) < Math.max(3, e.ry * .12) && Math.abs(Math.log(e.rx / c.pixel.rx)) < .15 && Math.abs(Math.log(e.ry / c.pixel.ry)) < .15)) continue;
		rounds.push({ pixel: e, geometry: roundGeometry(e, w, h), quality: 1, coverage: null, residual: null });
	}
	return { lines: raw.lines, rounds };
}
const trials: { engine: string; targetId: string; imageId: string; type: string; variant: string; uncertaintyPx: number; changed: boolean; reason: string; outcome: string; before: ReturnType<typeof contourError>; after: ReturnType<typeof contourError>; correctionBefore: boolean; correctionAfter: boolean; input: Geometry; output: Geometry }[] = [];
const coverage: { imageId: string; engine: string; targetId: string; semantic: string | undefined; candidateIndex: number | null; bestCandidateIndex: number | null; bestP95Px: number | null; thresholdPx: number }[] = [];
const auditRecords: { imageId: string; engine: string; type: string; index: number; code: string }[] = [];
const { cv } = await loadCv();
for (const sample of manifest.items) {
	const review = audit.images.find(r => r.imageId === sample.id);
	if (!review) throw Error(`MISSING_REVIEW:${sample.id}`);
	const selected = refs.targets.filter(r => r.imageId === sample.id);
	const raw = await readFile(new URL(sample.canonicalPath, root));
	if (digest(raw) !== sample.canonicalSha256) throw Error(`PHOTO_CHANGED:${sample.id}`);
	const rgba = selected.length ? await sharp(raw).ensureAlpha().raw().toBuffer() : null;
	const native = selected.length ? nativeDetections(await json(`edge-drawing/${sample.id}.json`), sample.width, sample.height) : null;
	for (const engine of ["baseline", "edge"] as const) {
		const path = engine === "baseline" ? `results/${sample.id}.json` : `edge-drawing/view-${sample.id}.json`;
		const storedBytes = await readFile(new URL(path, root));
		const stored = JSON.parse(storedBytes.toString()) as StoredResult;
		const captured = snapshot.find(r => r.imageId === sample.id && r.engine === engine);
		if (!captured || digest(storedBytes) !== captured.resultSha256 || review[engine].length !== stored.candidates.length) throw Error(`STALE_OR_INCOMPLETE_REVIEW:${sample.id}:${engine}`);
		for (const [i, code] of review[engine].entries()) {
			if (!/^[SFU][ANR?]$/.test(code)) throw Error(`UNKNOWN_REVIEW_CODE:${code}`);
			auditRecords.push({ imageId: sample.id, engine, type: stored.candidates[i]?.geometry.type ?? "", index: i + 1, code });
		}
		// Sanity check that the reproduced native matcher agrees with historical
		// probes. Timing differences are irrelevant; geometry must agree exactly.
		if (engine === "edge" && native) for (const local of stored.locals) if (JSON.stringify(fitDetected(native, local.input, sample.width, sample.height).output) !== JSON.stringify(local.output)) throw Error(`NATIVE_MATCHER_DRIFT:${sample.id}`);
		const roundRefs = new Map<string, Reference>();
		for (const r of selected.filter(r => r.type === "circle" || r.type === "ellipse")) {
			const key = `${r.center?.join(",")}`;
			if (!roundRefs.has(key) || r.type === "ellipse") roundRefs.set(key, r);
		}
		const used = new Set<number>();
		for (const r of roundRefs.values()) {
			const truth = geometry(r, sample.width, sample.height), thresholdPx = 2 * r.uncertaintyPx;
			const matches = stored.candidates.map((c, i) => ({ index: i + 1, ...contourError(c.geometry, truth, sample.width, sample.height) })).sort((a, b) => a.p95Px - b.p95Px);
			const best = matches[0], matched = matches.find(c => c.p95Px <= thresholdPx && !used.has(c.index));
			if (matched) used.add(matched.index);
			coverage.push({ imageId: sample.id, engine, targetId: r.id, semantic: r.semantic, candidateIndex: matched?.index ?? null, bestCandidateIndex: best?.index ?? null, bestP95Px: best?.p95Px ?? null, thresholdPx });
		}
		for (const r of selected) {
			const truth = geometry(r, sample.width, sample.height), w = sample.width, h = sample.height;
			validateAnnotation(truth, emptyMetadata(), w, h);
			const round = r.type === "circle" || r.type === "ellipse";
			const variants = [
				{ name: "reference", dx: 0, dy: 0, scale: 1, rotation: 0 },
				...[ [6,0], [-6,0], [0,6], [0,-6], [8,-8], [-8,8] ].map(([dx = 0, dy = 0]) => ({ name: `translate:${dx},${dy}`, dx, dy, scale: 1, rotation: 0 })),
				{ name: round ? "scale:0.88" : "rotate:-3deg", dx: 0, dy: 0, scale: round ? .88 : 1, rotation: round ? 0 : -3 },
				{ name: round ? "scale:1.12" : "rotate:+3deg", dx: 0, dy: 0, scale: round ? 1.12 : 1, rotation: round ? 0 : 3 },
			];
			const drafts = variants.map(v => perturb(truth, w, h, v.dx, v.dy, v.scale, v.rotation));
			const beforeBytes = JSON.stringify(drafts);
			if (!rgba || !native) throw Error("MISSING_PIXELS_OR_FEATURES");
			const results = engine === "baseline" ? analyze(cv, rgba, w, h, drafts, () => false, false).locals : drafts.map(d => fitDetected(native, d, w, h));
			if (JSON.stringify(drafts) !== beforeBytes) throw Error("TRIAL_INPUT_MUTATED");
			for (const [i, result] of results.entries()) {
				validateAnnotation(result.output, emptyMetadata(), w, h);
				if (result.output.type !== truth.type) throw Error("GEOMETRY_TYPE_CHANGED");
				const before = contourError(result.input, truth, w, h), after = contourError(result.output, truth, w, h), band = r.uncertaintyPx;
				const needsCorrection = (e: typeof before) => e.p95Px > band * 2 || (e.vertexPx ?? 0) > band * 2;
				const improvement = before.meanPx - after.meanPx;
				const outcome = !result.changed ? "retained" : improvement < -band || (after.vertexPx ?? 0) - (before.vertexPx ?? 0) > band ? "worsened" : improvement > band ? needsCorrection(after) ? "partial-improvement" : "improved-to-band" : "change-within-uncertainty";
				trials.push({ engine, targetId: r.id, imageId: sample.id, type: truth.type, variant: variants[i]?.name ?? "", uncertaintyPx: band, changed: result.changed, reason: result.reason, outcome, before, after, correctionBefore: needsCorrection(before), correctionAfter: needsCorrection(after), input: result.input, output: result.output });
			}
		}
	}
	process.stdout.write(`Reviewed ${sample.id}; ${selected.length} selected reference tasks\n`);
}
const count = <T>(values: T[], key: (v: T) => string) => values.reduce<Record<string, number>>((r, v) => { const k = key(v); r[k] = (r[k] ?? 0) + 1; return r; }, {});
const summaries = ["baseline", "edge"].map(engine => {
	const locals = trials.filter(t => t.engine === engine), candidates = auditRecords.filter(c => c.engine === engine), targets = coverage.filter(c => c.engine === engine);
	return { engine,
		candidateReview: { total: candidates.length, byTypeAndJudgement: count(candidates, c => `${c.type}:${c.code[0]}`), byJudgementAndSemantics: count(candidates, c => c.code), supported: candidates.filter(c => c.code[0] === "S").length, rejected: candidates.filter(c => c.code[0] === "F").length, uncertain: candidates.filter(c => c.code[0] === "U").length,
			interpretation: "Agent visual review of displayed candidates; NOT independent human precision, physical-hole verification, or exhaustive recall." },
		selectedTargetCoverage: { total: targets.length, matched: targets.filter(c => c.candidateIndex !== null).length, apertureTargets: targets.filter(c => c.semantic === "aperture").length, apertureMatched: targets.filter(c => c.semantic === "aperture" && c.candidateIndex !== null).length, interpretation: "Selected-reference contour coverage, one-to-one, after displayed candidate cap; NOT whole-image recall or physical-hole recall." },
		localTrials: ["line", "angle", "circle", "ellipse"].map(type => {
			const rows = locals.filter(t => t.type === type);
			return { type, targets: new Set(rows.map(t => t.targetId)).size, trials: rows.length, outcomes: count(rows, t => t.outcome), beforeMedianMeanPx: percentile(rows.map(t => t.before.meanPx), .5), afterMedianMeanPx: percentile(rows.map(t => t.after.meanPx), .5), beforeOutsideBand: rows.filter(t => t.correctionBefore).length, afterOutsideBand: rows.filter(t => t.correctionAfter).length,
				sensitivity: [1.5, 2, 3].map(multiplier => ({ uncertaintyMultiplier: multiplier, beforeOutside: rows.filter(t => t.before.p95Px > t.uncertaintyPx * multiplier || (t.before.vertexPx ?? 0) > t.uncertaintyPx * multiplier).length, afterOutside: rows.filter(t => t.after.p95Px > t.uncertaintyPx * multiplier || (t.after.vertexPx ?? 0) > t.uncertaintyPx * multiplier).length })) };
		}),
	};
});
const evidence = {
	generatedAt: new Date().toISOString(), status: "agent-technical-evaluation-complete-product-acceptance-not-claimed",
	method: "24 frozen approximate references on 11 existing real photos. Nine deterministic variations per task: reference, six translations, and two scale/rotation changes. Repeated variants are stress trials, NOT independent photos, human drafts, corrections, or timed operations. No parameter tuning on this reference set.",
	metric: "Symmetric sampled point-to-segment contour mean/P95 in canonical pixels; angle vertex displacement separately. Judgement band=2*reference uncertainty (sensitivity at 1.5x and 3x). Change smaller than reference uncertainty is inconclusive. Improvement is geometric only.",
	provenance: { referencesSha256: digest(refBytes), auditSha256: digest(auditBytes), resultSnapshotSha256: digest(snapshotBytes), coreSha256: digest(await readFile(new URL("core.ts", import.meta.url))), metricsSha256: digest(await readFile(new URL("metrics.ts", import.meta.url))), evaluatorSha256: digest(await readFile(new URL("evaluate.ts", import.meta.url))) },
	referenceCount: refs.targets.length, referencePhotoCount: new Set(refs.targets.map(t => t.imageId)).size, reviewedPhotoCount: manifest.items.length, candidateCount: auditRecords.length, trialCount: trials.length,
	summaries, coverage, auditRecords, trials,
	unmeasured: { actualHumanCompletionTime: null, actualHumanCorrectionsAndUndo: null, independentHumanPrecisionRecall: null, browserInitializationAndCancellation: null, phoneResponsiveness: null },
	limitations: ["One agent both specified references and reviewed results; not blinded or independent", "Reference coordinates are approximate visual judgements, not metrology or verified annotations", "Selected targets do not exhaust all visible features; paired circle/ellipse tasks are not independent physical objects", "Same MPDD sample families; no customer workplace, solid stepped shafts or actual phone tests", "Native precomputed features are not a browser implementation and cannot establish browser speed"],
};
await mkdir(destination, { recursive: true });
await writeFile(new URL("agent-evaluation.json", destination), JSON.stringify(evidence, null, 2));
await writeFile(new URL("review/evaluation-summary.json", root), JSON.stringify({ referenceCount: evidence.referenceCount, candidateCount: evidence.candidateCount, trialCount: evidence.trialCount, summaries }, null, 2));
process.stdout.write(`${JSON.stringify(summaries, null, 2)}\nSaved agent-evaluation.json; no human timing or phone pass claimed.\n`);
