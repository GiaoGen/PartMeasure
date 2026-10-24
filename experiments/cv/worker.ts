import type * as CV from "@techstark/opencv-js";
import type { Geometry } from "../../src/lib/annotations";
import { analyze } from "./core";

type Runtime = typeof CV & { onRuntimeInitialized?: () => void; onAbort?: () => void };
const scope = self as unknown as { importScripts: (url: string) => void; cv: Runtime; postMessage: (value: unknown) => void; onmessage: ((e: MessageEvent) => void) | null };
const started = performance.now();
scope.importScripts("/opencv.js");
const cv = scope.cv;
let ready = false;
const initialized = () => { ready = true; scope.postMessage({ kind: "ready", initializationMs: performance.now() - started }); };
if (typeof cv.Mat === "function") initialized();
else { cv.onRuntimeInitialized = initialized; cv.onAbort = () => scope.postMessage({ kind: "error", message: "CV_INITIALIZATION_FAILED" }); }
scope.onmessage = (event: MessageEvent<{ id: number; rgba: Uint8Array; width: number; height: number; drafts: Geometry[]; candidates: boolean }>) => {
	const request = event.data;
	try {
		if (!ready) throw Error("CV_NOT_READY");
		const result = analyze(cv, request.rgba, request.width, request.height, request.drafts, () => false, request.candidates);
		scope.postMessage({ kind: "result", id: request.id, result });
	} catch (error) { scope.postMessage({ kind: "error", id: request.id, message: error instanceof Error ? error.message : "CV_FAILED" }); }
};
