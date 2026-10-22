type Entry = {
	value: unknown;
	freshUntil: number;
	retainUntil: number;
	bytes: number;
	tags: string[];
};
type Pending = {
	promise: Promise<unknown>;
	controller: AbortController;
	valid: boolean;
	tags: string[];
	users: number;
	settled: boolean;
};
/** One identity's bounded memory. Stale display and authoritative reads are separate. */
export class QueryCache {
	private generation = 0;
	private bytes = 0;
	private values = new Map<string, Entry>();
	private pending = new Map<string, Pending>();
	private versions = new Map<string, string>();
	constructor(
		private maxEntries = 64,
		private maxBytes = 2 * 1024 * 1024,
		private retainMs = 120000,
	) {}
	private remove(key: string) {
		const entry = this.values.get(key);
		if (entry) this.bytes -= entry.bytes;
		this.values.delete(key);
	}
	clear() {
		this.generation++;
		for (const p of this.pending.values()) p.valid = false;
		this.values.clear();
		this.pending.clear();
		this.versions.clear();
		this.bytes = 0;
	}
	markStale() {
		for (const entry of this.values.values()) entry.freshUntil = 0;
	}
	invalidate(tags: string[]) {
		for (const [key, entry] of this.values)
			if (entry.tags.some((t) => tags.includes(t))) this.remove(key);
		for (const [key, entry] of this.pending)
			if (entry.tags.some((t) => tags.includes(t))) {
				entry.valid = false;
				this.pending.delete(key);
			}
	}
	observeVersion(key: string, version: string, tags: string[]) {
		const previous = this.versions.get(key);
		if (previous !== undefined && previous !== version) this.invalidate(tags);
		this.versions.delete(key);
		this.versions.set(key, version);
		if (this.versions.size > this.maxEntries) {
			const oldest = this.versions.keys().next().value;
			if (oldest !== undefined) this.versions.delete(oldest);
		}
	}
	peek<T>(key: string): T | undefined {
		const entry = this.values.get(key);
		if (!entry) return undefined;
		if (entry.retainUntil <= Date.now()) {
			this.remove(key);
			return undefined;
		}
		this.values.delete(key);
		this.values.set(key, entry);
		return structuredClone(entry.value) as T;
	}
	set<T>(key: string, value: T, ttl: number, tags: string[]) {
		this.remove(key);
		if (ttl <= 0) return;
		const bytes = JSON.stringify(value)?.length * 2 || 0;
		if (bytes < 1 || bytes > this.maxBytes) return;
		this.values.set(key, {
			value: structuredClone(value),
			freshUntil: Date.now() + Math.min(ttl, this.retainMs),
			retainUntil: Date.now() + this.retainMs,
			bytes,
			tags,
		});
		this.bytes += bytes;
		while (this.values.size > this.maxEntries || this.bytes > this.maxBytes) {
			const oldest = this.values.keys().next().value;
			if (oldest === undefined) break;
			this.remove(oldest);
		}
	}
	seed<T>(key: string, value: T, ttl: number, tags: string[]) {
		const pending = this.pending.get(key);
		if (pending) { pending.valid = false; this.pending.delete(key); }
		this.set(key, value, ttl, tags);
	}
	private consume<T>(
		key: string,
		pending: Pending,
		signal?: AbortSignal,
	): Promise<T> {
		pending.users++;
		return new Promise<T>((resolve, reject) => {
			let done = false;
			const finish = (error: unknown, value?: unknown) => {
				if (done) return;
				done = true;
				signal?.removeEventListener("abort", abort);
				pending.users--;
				// Same-turn React handoffs may attach another consumer before cancellation.
				queueMicrotask(() => {
					if (!pending.users && !pending.settled) {
						pending.valid = false;
						if (this.pending.get(key) === pending) this.pending.delete(key);
						pending.controller.abort();
					}
				});
				if (error !== undefined) reject(error);
				else resolve(structuredClone(value) as T);
			};
			const abort = () =>
				finish(signal?.reason ?? new DOMException("Aborted", "AbortError"));
			signal?.addEventListener("abort", abort, { once: true });
			if (signal?.aborted) abort();
			pending.promise.then(
				(value) => finish(undefined, value),
				(error) => finish(error),
			);
		});
	}
	async read<T>(
		key: string,
		load: (signal: AbortSignal) => Promise<T>,
		ttl = 0,
		tags: string[] = [],
		retry = 1,
		options: {
			signal?: AbortSignal | undefined;
			refresh?: boolean | undefined;
		} = {},
	): Promise<T> {
		options.signal?.throwIfAborted();
		for (const [k, v] of this.values)
			if (v.retainUntil <= Date.now()) this.remove(k);
		const cached = this.values.get(key);
		if (!options.refresh && ttl > 0 && cached && cached.freshUntil > Date.now())
			return this.peek<T>(key) as T;
		const existing = this.pending.get(key);
		if (existing) return this.consume<T>(key, existing, options.signal);
		if (this.pending.size >= this.maxEntries)
			throw Error("同时读取的资料过多，请稍后重试。");
		const generation = this.generation;
		const pending: Pending = {
			promise: Promise.resolve(),
			controller: new AbortController(),
			valid: true,
			tags,
			users: 0,
			settled: false,
		};
		pending.promise = (async () => {
			const value = await load(pending.controller.signal);
			pending.controller.signal.throwIfAborted();
			if (!pending.valid && generation === this.generation) {
				if (!retry) throw Error("资料刚有更新，请重试读取。");
				return this.read(key, load, ttl, tags, retry - 1, {
					signal: pending.controller.signal,
				});
			}
			if (generation === this.generation && pending.valid)
				this.set(key, value, ttl, tags);
			return value;
		})().finally(() => {
			pending.settled = true;
			if (this.pending.get(key) === pending) this.pending.delete(key);
		});
		this.pending.set(key, pending);
		return this.consume<T>(key, pending, options.signal);
	}
}
