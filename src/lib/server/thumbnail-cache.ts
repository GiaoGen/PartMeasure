import "server-only";
/** Process-local immutable bytes only. Authorization must run before every read. */
export class ThumbnailCache {
	private entries = new Map<string, { bytes: Uint8Array; expires: number }>();
	private pending = new Map<string, Promise<Uint8Array>>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	constructor(
		private budget = 8 * 1024 * 1024,
		private count = 64,
		private ttl = 60000,
	) {}
	private expire() {
		clearTimeout(this.timer);
		for (const [key, e] of this.entries) if (e.expires <= Date.now()) this.entries.delete(key);
		if (!this.entries.size) return;
		const next = Math.min(...[...this.entries.values()].map((e) => e.expires));
		this.timer = setTimeout(() => this.expire(), Math.max(1, next - Date.now()));
		this.timer.unref?.();
	}
	async read(key: string, load: () => Promise<Uint8Array>) {
		for (const [k, e] of this.entries) if (e.expires <= Date.now()) this.entries.delete(k);
		const cached = this.entries.get(key);
		if (cached) {
			this.entries.delete(key);
			this.entries.set(key, cached);
			return cached.bytes.slice();
		}
		const existing = this.pending.get(key);
		if (existing) return (await existing).slice();
		// Avoid retaining unbounded parallel downloads; callers may fall back to streaming.
		if (this.pending.size >= 16) return null;
		const pending = load();
		this.pending.set(key, pending);
		try {
			const bytes = await pending;
			if (bytes.byteLength <= 262144 && bytes.byteLength <= this.budget) {
				let used = [...this.entries.values()].reduce((n, e) => n + e.bytes.byteLength, 0);
				while (this.entries.size >= this.count || used + bytes.byteLength > this.budget) {
					const k = this.entries.keys().next().value;
					if (k === undefined) break;
					used -= this.entries.get(k)?.bytes.byteLength ?? 0;
					this.entries.delete(k);
				}
				this.entries.set(key, { bytes: bytes.slice(), expires: Date.now() + this.ttl });
				this.expire();
			}
			return bytes.slice();
		} finally {
			if (this.pending.get(key) === pending) this.pending.delete(key);
		}
	}
}
