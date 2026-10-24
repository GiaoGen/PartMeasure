import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyMetadata, validateAnnotation, type AnnotationDraft, type CanonicalImage, type Geometry } from "../../src/lib/annotations";
import { CvClient, type CvWorker } from "../../src/lib/cv/client";
import { cvDraftUpdate, type CvDraftTicket } from "../../src/lib/cv/draft";
import { cvGeometry, cvRaster, CV_WORKER_CSP, type CvRequest, type CvResponse } from "../../src/lib/cv/protocol";
import nextConfig from "../../next.config";

const image: CanonicalImage = { id: "image-a", width: 4031, height: 3023, imageHash: "a".repeat(64), normalizationVersion: 1 };
const geometries: Geometry[] = [
	{ type: "line", from: { x: .2, y: .3 }, to: { x: .7, y: .3 } },
	{ type: "angle", from: { x: .2, y: .5 }, vertex: { x: .5, y: .5 }, to: { x: .5, y: .2 }, reflex: true, arcScale: .4 },
	{ type: "circle", center: { x: .5, y: .5 }, radiusX: 300 / 4031, radiusY: 300 / 3023 },
	{ type: "ellipse", center: { x: .5, y: .5 }, axisA: { x: .5 + 400 * Math.cos(.4) / 4031, y: .5 + 400 * Math.sin(.4) / 3023 }, axisB: { x: .5 - 160 * Math.sin(.4) / 4031, y: .5 + 160 * Math.cos(.4) / 3023 } },
];
describe("CV image coordinates and draft-only application", () => {
	it.each(geometries)("keeps $type valid on an odd-size photo and round trips without stretching", geometry => {
		const before = structuredClone(geometry), raster = cvRaster(image.width, image.height);
		expect(raster.width * raster.height).toBeLessThanOrEqual(1024 * 1024);
		const reduced = cvGeometry(geometry, raster, "to-raster");
		expect(() => validateAnnotation(reduced, emptyMetadata(), raster.width, raster.height)).not.toThrow();
		const restored = cvGeometry(reduced, raster, "to-canonical");
		expect(() => validateAnnotation(restored, emptyMetadata(), image.width, image.height)).not.toThrow();
		// Compare to far below a canonical pixel; binary floating-point roundoff
		// must not be mistaken for stretched geometry.
		const precise = (g: Geometry) => JSON.parse(JSON.stringify(g, (_key, value) => typeof value === "number" ? Number(value.toFixed(12)) : value));
		expect(precise(restored)).toEqual(precise(geometry));
		expect(geometry).toEqual(before);
	});
	it("does not upscale small photos, rejects invalid dimensions and bounds landscape/portrait rasters", () => {
		expect(cvRaster(240, 320)).toMatchObject({ width: 240, height: 320, scale: 1 });
		for (const [w, h] of [[15001, 9133], [9133, 15001], [16384, 1]]) {
			const r = cvRaster(w ?? 0, h ?? 0);
			expect(r.width).toBeLessThanOrEqual(1024); expect(r.height).toBeLessThanOrEqual(1024);
		}
		expect(() => cvRaster(Number.NaN, 100)).toThrow();
	});
	it("changes only the new draft geometry, preserving all human dimensions and leaving the input intact", () => {
		const original = geometries[0] as Geometry, ticket: CvDraftTicket = { id: "new", imageId: image.id, imageHash: image.imageHash, version: 7, geometry: original };
		const current: AnnotationDraft = { id: ticket.id, geometry: original, metadata: { ...emptyMetadata(), dimension: "12.5", notes: "人工证据" } };
		const output: Geometry = { type: "line", from: { x: .2, y: .31 }, to: { x: .7, y: .31 } };
		const context = { image, current, selected: ticket.id, version: 7, saved: false, editable: true };
		const snapshot = structuredClone(context);
		const changed = cvDraftUpdate(ticket, output, context);
		expect(changed?.geometry).toEqual(output); expect(changed?.metadata).toEqual(current.metadata); expect(context).toEqual(snapshot);
		for (const invalid of [
			{ ...context, editable: false }, { ...context, saved: true }, { ...context, version: 8 },
			{ ...context, selected: "other" },
			{ ...context, current: undefined }, { ...context, current: { ...current, geometry: output } },
			{ ...context, image: { ...image, id: "other" } }, { ...context, image: { ...image, imageHash: "b".repeat(64) } },
		]) expect(cvDraftUpdate(ticket, output, invalid)).toBeNull();
		expect(cvDraftUpdate(ticket, { type: "circle", center: { x: .5, y: .5 }, radiusX: .1, radiusY: .1 }, context)).toBeNull();
		expect(cvDraftUpdate(ticket, { type: "line", from: { x: -1, y: 0 }, to: { x: .7, y: .3 } }, context)).toBeNull();
	});
	it("allows same-origin workers without allowing eval in page documents; worker exception is isolated", async () => {
		const headers = await nextConfig.headers?.();
		expect(headers?.find(r => r.source === "/cv/worker-v1.js")?.headers).toContainEqual({ key: "Content-Security-Policy", value: CV_WORKER_CSP });
		expect(headers?.find(r => r.source === "/:path*")?.headers.some(h => h.key === "Content-Security-Policy" && h.value.includes("unsafe-eval"))).toBe(false);
	});
});

function fakeWorker() {
	const worker: CvWorker = { onmessage: null, onerror: null, onmessageerror: null, postMessage: vi.fn(), terminate: vi.fn() };
	return { worker, emit: (data: CvResponse) => worker.onmessage?.call(worker as Worker, { data } as MessageEvent),
		request: () => vi.mocked(worker.postMessage).mock.calls[0]?.[0] as CvRequest };
}
const request = () => ({ rgba: new ArrayBuffer(16 * 16 * 4), width: 16, height: 16, drafts: [], candidates: true });
const empty = { candidates: [], locals: [] };
afterEach(() => { vi.useRealTimers(); });
describe("on-demand cancellable CV worker", () => {
	it("is lazy, transfers bounded pixels once, ignores stale result ids and releases an idle worker", async () => {
		vi.useFakeTimers();
		const fake = fakeWorker(), create = vi.fn(() => fake.worker), client = new CvClient(create), input = request();
		expect(create).not.toHaveBeenCalled();
		const run = client.run(input, new AbortController().signal);
		expect(create).toHaveBeenCalledOnce();
		fake.emit({ kind: "ready" }); await Promise.resolve();
		expect(fake.worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ rgba: input.rgba }), [input.rgba]);
		fake.emit({ kind: "result", id: 9999, result: empty });
		fake.emit({ kind: "result", id: fake.request().id, result: empty });
		await expect(run).resolves.toEqual(empty);
		await vi.advanceTimersByTimeAsync(45000); expect(fake.worker.terminate).toHaveBeenCalledOnce();
	});
	it.each(["loading", "computing"])("cancels during %s and can retry with a new worker", async phase => {
		const first = fakeWorker(), second = fakeWorker(), create = vi.fn().mockReturnValueOnce(first.worker).mockReturnValueOnce(second.worker), client = new CvClient(create), abort = new AbortController();
		const rejected = expect(client.run(request(), abort.signal)).rejects.toMatchObject({ name: "AbortError" });
		if (phase === "computing") { first.emit({ kind: "ready" }); await Promise.resolve(); }
		const staleHandler = first.worker.onmessage;
		const staleError = first.worker.onerror;
		abort.abort(); await rejected;
		expect(first.worker.terminate).toHaveBeenCalledOnce();
		const retry = client.run(request(), new AbortController().signal);
		staleHandler?.call(first.worker as Worker, { data: { kind: "ready" } } as MessageEvent);
		staleError?.call(first.worker as Worker, {} as ErrorEvent);
		expect(second.worker.terminate).not.toHaveBeenCalled();
		second.emit({ kind: "ready" }); await Promise.resolve();
		second.emit({ kind: "result", id: second.request().id, result: empty });
		await expect(retry).resolves.toEqual(empty); client.cancel();
	});
	it.each(["loading", "computing"])("times out while %s without leaving a worker running", async phase => {
		vi.useFakeTimers();
		const fake = fakeWorker(), client = new CvClient(() => fake.worker);
		const rejected = expect(client.run(request(), new AbortController().signal)).rejects.toThrow(phase === "loading" ? "CV_LOAD_TIMEOUT" : "CV_COMPUTE_TIMEOUT");
		if (phase === "computing") { fake.emit({ kind: "ready" }); await Promise.resolve(); }
		await vi.advanceTimersByTimeAsync(phase === "loading" ? 20000 : 8000); await rejected;
		expect(fake.worker.terminate).toHaveBeenCalledOnce();
	});
	it("rejects overlapping work and malformed pixels before dispatch", async () => {
		const fake = fakeWorker(), create = vi.fn(() => fake.worker), client = new CvClient(create);
		await expect(client.run({ ...request(), width: 2.5 }, new AbortController().signal)).rejects.toThrow("CV_IMAGE_BUDGET");
		expect(create).not.toHaveBeenCalled();
		const abort = new AbortController(), rejected = expect(client.run(request(), abort.signal)).rejects.toMatchObject({ name: "AbortError" });
		await expect(client.run(request(), new AbortController().signal)).rejects.toThrow("CV_BUSY");
		abort.abort(); await rejected;
	});
	it("fails closed when Worker construction is blocked, without an unhandled initialization promise", async () => {
		const client = new CvClient(() => { throw Error("blocked"); });
		await expect(client.run(request(), new AbortController().signal)).rejects.toThrow("CV_WORKER_UNAVAILABLE");
		client.cancel();
	});
});
