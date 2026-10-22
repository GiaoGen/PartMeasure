import { onApiSessionCleared } from "./api";
import { privateImage, onPrivateImageInvalidated } from "./private-image-cache";
type Decoded = { key: string; image: HTMLImageElement; releaseBytes: () => void; valid: boolean };
const active = new Set<Decoded>();
const pending = new Set<{ key: string; controller: AbortController }>();
let recent: Decoded | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined;
function dispose(value: Decoded) { value.valid = false; value.image.src = ""; value.releaseBytes(); active.delete(value); if (recent === value) recent = undefined; }
function invalidate(matches: (key: string) => boolean) {
	for (const value of pending) if (matches(value.key)) value.controller.abort();
	for (const value of [...active]) if (matches(value.key)) dispose(value);
	if (recent && matches(recent.key)) { clearTimeout(expiry); dispose(recent); }
}
onApiSessionCleared(() => invalidate(() => true));
onPrivateImageInvalidated(prefix => invalidate(key => key.startsWith(prefix)));
/** Keep only the most recent inactive decoded standard image, for at most 20 seconds. */
export async function decodedImage(src: string, version: string, width: number, height: number, signal: AbortSignal) {
	const key = `${src}:${version}:${width}:${height}`;
	signal.throwIfAborted();
	let value = recent?.key === key && recent.valid ? recent : undefined;
	if (value) { clearTimeout(expiry); recent = undefined; }
	else {
		const loading = { key, controller: new AbortController() };
		pending.add(loading);
		const decodingSignal = AbortSignal.any([signal, loading.controller.signal]);
		let bytes: Awaited<ReturnType<typeof privateImage>>;
		try { bytes = await privateImage(src, version, decodingSignal); }
		catch (error) { pending.delete(loading); throw error; }
		const image = new window.Image();
		try {
			await new Promise<void>((resolve, reject) => {
				const finish = (error?: Error) => { decodingSignal.removeEventListener("abort", abort); image.onload = image.onerror = null; if (error) reject(error); else resolve(); };
				const abort = () => finish(new DOMException("Aborted", "AbortError"));
				image.onload = () => finish();
				image.onerror = () => finish(Error("IMAGE_DECODE"));
				decodingSignal.addEventListener("abort", abort, { once: true });
				if (decodingSignal.aborted) abort(); else image.src = bytes.url;
			});
			decodingSignal.throwIfAborted();
			if (image.naturalWidth !== width || image.naturalHeight !== height) throw Error("IMAGE_DIMENSIONS");
		} catch (error) { image.src = ""; bytes.release(); throw error; }
		finally { pending.delete(loading); }
		value = { key, image, releaseBytes: bytes.release, valid: true };
	}
	active.add(value);
	const acquired = value;
	let released = false;
	return { image: acquired.image, release: () => {
		if (released) return; released = true;
		active.delete(acquired);
		if (!acquired.valid || signal.aborted && acquired.image.naturalWidth === 0) { dispose(acquired); return; }
		if (recent) dispose(recent);
		clearTimeout(expiry); recent = acquired;
		expiry = setTimeout(() => { if (recent === acquired) dispose(acquired); }, 20000);
	} };
}
