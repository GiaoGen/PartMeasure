import { createRequire } from "node:module";
import type * as CV from "@techstark/opencv-js";

export async function loadCv() {
	const started = performance.now();
	const require = createRequire(import.meta.url);
	const cv = require("@techstark/opencv-js") as typeof CV & { onRuntimeInitialized?: () => void; onAbort?: (reason: unknown) => void; HEAPU8?: Uint8Array };
	// OpenCV 4.12 exposes a self-resolving Emscripten thenable. Awaiting it
	// directly loops indefinitely; resolve a void signal and return a wrapper.
	if (typeof cv.Mat !== "function") await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(Error("CV_INITIALIZATION_TIMEOUT")), 20000);
		cv.onRuntimeInitialized = () => { clearTimeout(timer); resolve(); };
		cv.onAbort = () => { clearTimeout(timer); reject(Error("CV_INITIALIZATION_FAILED")); };
	});
	return { cv, initializationMs: performance.now() - started };
}
