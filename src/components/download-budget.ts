import { ImageTransfers } from "./image-transfers";
/** Encoded buffers + assembly reserve. Browser/GC/native download memory is outside this accounting. */
export class DownloadBudget {
	private used = 0;
	private queue: { bytes: number; signal: AbortSignal; resolve: () => void; reject: (error: unknown) => void; cancel: () => void }[] = [];
	constructor(private limit = 256 * 1024 * 1024) {}
	async acquire(bytes: number, signal: AbortSignal) {
		signal.throwIfAborted();
		if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > this.limit) throw Error("DOWNLOAD_MEMORY_LIMIT");
		if (this.used + bytes <= this.limit && !this.queue.length) this.used += bytes;
		else await new Promise<void>((resolve, reject) => {
			if (this.queue.length >= 20) { reject(Error("DOWNLOAD_QUEUE_LIMIT")); return; }
			const item = { bytes, signal, resolve, reject, cancel: () => { const index = this.queue.indexOf(item); if (index >= 0) this.queue.splice(index, 1); reject(signal.reason); this.pump(); } };
			this.queue.push(item); signal.addEventListener("abort", item.cancel, { once: true });
		});
		let held = bytes;
		return { shrink: (next: number) => { if (next >= 0 && next < held) { this.used -= held - next; held = next; this.pump(); } }, release: () => { this.used -= held; held = 0; this.pump(); } };
	}
	private pump() {
		while (this.queue[0] && this.used + this.queue[0].bytes <= this.limit) {
			const next = this.queue.shift(); if (!next) return;
			next.signal.removeEventListener("abort", next.cancel);
			if (next.signal.aborted) next.reject(next.signal.reason);
			else { this.used += next.bytes; next.resolve(); }
		}
	}
}
export const downloadBudget = new DownloadBudget();
export const downloadTransfers = new ImageTransfers(2, 20);
export async function rangeBytes(response: Response, expected: number, signal: AbortSignal, onProgress: (bytes: number) => void) {
	const reader = response.body?.getReader();
	if (!reader) throw Error("INCOMPLETE");
	const bytes = new Uint8Array(expected);
	let offset = 0;
	try {
		while (true) {
			signal.throwIfAborted();
			const part = await reader.read(); if (part.done) break;
			if (offset + part.value.byteLength > expected) throw Error("RANGE_SIZE");
			bytes.set(part.value, offset); offset += part.value.byteLength; onProgress(offset);
		}
		if (offset !== expected) throw Error("INCOMPLETE");
		return bytes;
	} catch (error) { await reader.cancel().catch(() => {}); throw error; }
	finally { reader.releaseLock(); }
}
