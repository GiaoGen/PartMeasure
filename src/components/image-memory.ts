import { ApiError } from "./api";
type Entry = {
	url: string;
	bytes: number;
	users: number;
	expires: number;
	timer?: ReturnType<typeof setTimeout>;
};
type Load = (signal: AbortSignal, reserve: (bytes: number) => void) => Promise<Blob>;
/** Encoded image bytes only; decoded canvas/bitmap memory is outside this budget. */
export class PrivateImageCache {
	private entries = new Map<string, Entry>();
	private pending = new Map<string, Promise<Entry>>();
	private waiters = new WeakMap<Promise<Entry>, number>();
	private controllers = new Map<string, AbortController>();
	private reserved = new Map<string, number>();
	private epoch = 0;
	constructor(
		private budget = 96 * 1024 * 1024,
		private maxEntries = 48,
		private idleMs = 60000,
	) {}
	private remove(key: string) {
		const entry = this.entries.get(key);
		if (!entry) return;
		clearTimeout(entry.timer);
		URL.revokeObjectURL(entry.url);
		this.entries.delete(key);
	}
	clear() {
		this.epoch++;
		this.invalidate(() => true);
	}
	/** Acquire only a retained object; preview transitions must not start another transfer. */
	cached(key: string) {
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		if (!entry.users && entry.expires <= Date.now()) { this.remove(key); return undefined; }
		return this.hold(key, entry);
	}
	invalidate(matches: (key: string) => boolean) {
		for (const [key, controller] of this.controllers)
			if (matches(key)) {
				controller.abort();
				this.controllers.delete(key);
				this.pending.delete(key);
				this.reserved.delete(key);
			}
		for (const key of this.entries.keys()) if (matches(key)) this.remove(key);
	}
	private room(bytes: number, key: string) {
		if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > this.budget)
			throw Error("IMAGE_CACHE_LIMIT");
		let used =
			[...this.entries.values()].reduce((n, e) => n + e.bytes, 0) +
			[...this.reserved].reduce((n, [k, v]) => n + (k === key ? 0 : v), 0);
		for (const [k, e] of this.entries) {
			if (used + bytes <= this.budget && this.entries.size < this.maxEntries) break;
			if (e.users) continue;
			used -= e.bytes;
			this.remove(k);
		}
		if (used + bytes > this.budget || this.entries.size >= this.maxEntries)
			throw Error("IMAGE_CACHE_BUSY");
	}
	private waitFor(key: string, promise: Promise<Entry>, signal?: AbortSignal) {
		this.waiters.set(promise, (this.waiters.get(promise) ?? 0) + 1);
		return new Promise<Entry>((resolve, reject) => {
			let done = false;
			const finish = (error: unknown, entry?: Entry) => {
				if (done) return;
				done = true;
				signal?.removeEventListener("abort", abort);
				this.waiters.set(promise, (this.waiters.get(promise) ?? 1) - 1);
				queueMicrotask(() => {
					if (!this.waiters.get(promise) && this.pending.get(key) === promise)
						this.invalidate(candidate => candidate === key);
				});
				if (error !== undefined) reject(error);
				else resolve(entry as Entry);
			};
			const abort = () => finish(signal?.reason ?? new DOMException("Aborted", "AbortError"));
			signal?.addEventListener("abort", abort, { once: true });
			if (signal?.aborted) abort();
			promise.then(entry => finish(undefined, entry), error => finish(error));
		});
	}
	async acquire(key: string, load: Load, signal?: AbortSignal) {
		signal?.throwIfAborted();
		let entry = this.entries.get(key);
		if (entry && !entry.users && entry.expires <= Date.now()) {
			this.remove(key);
			entry = undefined;
		}
		if (!entry) {
			let promise = this.pending.get(key);
			if (!promise) {
				if (this.pending.size >= this.maxEntries) throw Error("IMAGE_CACHE_BUSY");
				const epoch = this.epoch,
					controller = new AbortController();
				this.controllers.set(key, controller);
				const reserve = (bytes: number) => {
					controller.signal.throwIfAborted();
					this.room(bytes, key);
					this.reserved.set(key, bytes);
				};
				promise = load(controller.signal, reserve)
					.then((blob) => {
						if (epoch !== this.epoch) throw new ApiError("AUTH_REQUIRED", 401);
						if (this.controllers.get(key) !== controller)
							throw new ApiError("IMAGE_NOT_READY", 409);
						this.room(blob.size, key);
						this.reserved.delete(key);
						const value: Entry = {
							url: URL.createObjectURL(blob),
							bytes: blob.size,
							users: 0,
							expires: Date.now() + this.idleMs,
						};
						this.entries.set(key, value);
						return value;
					})
					.finally(() => {
						if (this.pending.get(key) === promise) this.pending.delete(key);
						if (this.controllers.get(key) === controller) {
							this.controllers.delete(key);
							this.reserved.delete(key);
						}
					});
				this.pending.set(key, promise);
			}
			entry = await this.waitFor(key, promise, signal);
		}
		if (this.entries.get(key) !== entry) throw new ApiError("AUTH_REQUIRED", 401);
		return this.hold(key, entry);
	}
	private hold(key: string, entry: Entry) {
		entry.users++;
		clearTimeout(entry.timer);
		this.entries.delete(key);
		this.entries.set(key, entry);
		let released = false;
		const acquired = entry;
		return {
			url: entry.url,
			release: () => {
				if (released) return;
				released = true;
				acquired.users--;
				if (!acquired.users && this.entries.get(key) === acquired) {
					acquired.expires = Date.now() + this.idleMs;
					acquired.timer = setTimeout(() => {
						if (this.entries.get(key) === acquired && !acquired.users) this.remove(key);
					}, this.idleMs);
					(acquired.timer as unknown as { unref?: () => void }).unref?.();
				}
			},
		};
	}
}

export async function boundedImageBlob(
	response: Response,
	signal: AbortSignal,
	reserve: (bytes: number) => void,
	max = 80 * 1024 * 1024,
) {
	const declared = response.headers.get("content-length");
	const capacity = declared === null ? max : Number(declared);
	if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > max) {
		await response.body?.cancel();
		throw Error("IMAGE_CACHE_LIMIT");
	}
	try {
		reserve(capacity);
	} catch (e) {
		await response.body?.cancel();
		throw e;
	}
	const reader = response.body?.getReader();
	if (!reader) throw Error("IMAGE_FORMAT");
	const chunks: ArrayBuffer[] = [];
	let bytes = 0;
	try {
		while (true) {
			signal.throwIfAborted();
			const part = await reader.read();
			if (part.done) break;
			bytes += part.value.byteLength;
			if (bytes > capacity) throw Error("IMAGE_CACHE_LIMIT");
			chunks.push(part.value.slice().buffer as ArrayBuffer);
		}
		if (declared !== null && bytes !== capacity) throw Error("IMAGE_SIZE_MISMATCH");
		return new Blob(chunks, { type: "image/webp" });
	} catch (e) {
		await reader.cancel().catch(() => {});
		throw e;
	} finally {
		reader.releaseLock();
	}
}
