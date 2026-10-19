/** Per-browser memory only. Versions/URLs scope entities; invalidation fences late reads. */
export class QueryCache {
	private generation = 0;
	private bytes = 0;
	private values = new Map<
		string,
		{ value: unknown; expires: number; bytes: number; tags: string[] }
	>();
	private pending = new Map<
		string,
		{ promise: Promise<unknown>; valid: boolean; tags: string[] }
	>();
	constructor(
		private maxEntries = 64,
		private maxBytes = 2 * 1024 * 1024,
	) {}
	clear() {
		this.generation++;
		for (const p of this.pending.values()) p.valid = false;
		this.values.clear();
		this.pending.clear();
		this.bytes = 0;
	}
	invalidate(tags: string[]) {
		for (const [key, entry] of this.values)
			if (entry.tags.some((t) => tags.includes(t))) {
				this.bytes -= entry.bytes;
				this.values.delete(key);
			}
		for (const [key, entry] of this.pending)
			if (entry.tags.some((t) => tags.includes(t))) {
				entry.valid = false;
				this.pending.delete(key);
			}
	}
	async read<T>(
		key: string,
		load: () => Promise<T>,
		ttl = 0,
		tags: string[] = [],
		retry = 1,
	): Promise<T> {
		for (const [k, v] of this.values)
			if (v.expires <= Date.now()) {
				this.bytes -= v.bytes;
				this.values.delete(k);
			}
		const cached = this.values.get(key);
		if (ttl > 0 && cached && cached.expires > Date.now()) {
			this.values.delete(key);
			this.values.set(key, cached);
			return structuredClone(cached.value) as T;
		}
		if (cached) {
			this.values.delete(key);
			this.bytes -= cached.bytes;
		}
		const existing = this.pending.get(key);
		if (existing) return structuredClone(await existing.promise) as T;
		if (this.pending.size >= this.maxEntries) throw Error("同时读取的资料过多，请稍后重试。");
		const generation = this.generation;
		const pending: { promise: Promise<unknown>; valid: boolean; tags: string[] } = {
			promise: Promise.resolve(),
			valid: true,
			tags,
		};
		pending.promise = (async () => {
			const value = await load();
			if (!pending.valid && generation === this.generation) {
				if (!retry) throw Error("资料刚有更新，请重试读取。");
				return this.read(key, load, ttl, tags, retry - 1);
			}
			if (generation === this.generation && pending.valid && ttl > 0) {
				const size = JSON.stringify(value)?.length * 2 || 0;
				if (size > 0 && size <= this.maxBytes) {
					this.values.set(key, {
						value: structuredClone(value),
						expires: Date.now() + Math.min(ttl, 5000),
						bytes: size,
						tags,
					});
					this.bytes += size;
					while (this.values.size > this.maxEntries || this.bytes > this.maxBytes) {
						const oldest = this.values.keys().next().value;
						if (oldest === undefined) break;
						this.bytes -= this.values.get(oldest)?.bytes ?? 0;
						this.values.delete(oldest);
					}
				}
			}
			return value;
		})();
		this.pending.set(key, pending);
		try {
			return structuredClone(await pending.promise) as T;
		} finally {
			if (this.pending.get(key) === pending) this.pending.delete(key);
		}
	}
}
