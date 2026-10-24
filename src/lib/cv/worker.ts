import type * as CV from "@techstark/opencv-js";
import { analyze } from "./core";
import { CV_VENDOR_URL, type CvRequest, type CvResponse } from "./protocol";

type Runtime = typeof CV & { onRuntimeInitialized?: () => void; onAbort?: () => void };
const scope = self as unknown as { importScripts: (url: string) => void; cv: Runtime; postMessage: (value: CvResponse) => void; onmessage: ((e: MessageEvent<CvRequest>) => void) | null };
let ready = false;
try {
	scope.importScripts(CV_VENDOR_URL);
	const cv = scope.cv;
	// Do not await this Emscripten self-resolving thenable.
	const initialized = () => { ready = true; scope.postMessage({ kind: "ready" }); };
	if (typeof cv.Mat === "function") initialized();
	else { cv.onRuntimeInitialized = initialized; cv.onAbort = () => scope.postMessage({ kind: "error", message: "CV_INITIALIZATION_FAILED" }); }
	scope.onmessage = ({ data: r }) => {
		try {
			if (!ready) throw Error("CV_NOT_READY");
			if (r.drafts.length > 1) throw Error("CV_DRAFT_BUDGET");
			const result = analyze(cv, new Uint8Array(r.rgba), r.width, r.height, r.drafts, () => false, r.candidates);
			scope.postMessage({ kind: "result", id: r.id, result: {
				candidates: result.candidates.map(c => c.geometry),
				locals: result.locals.map(l => ({ output: l.output, changed: l.changed, reason: l.reason })),
			} });
		} catch { scope.postMessage({ kind: "error", id: r.id, message: "CV_COMPUTE_FAILED" }); }
	};
} catch { scope.postMessage({ kind: "error", message: "CV_INITIALIZATION_FAILED" }); }
