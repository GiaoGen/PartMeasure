/** Bounded shared transfer gate. Aborted waiters leave immediately, including on logout. */
export class ImageTransfers {
	private active = 0;
	private queue: { grant: () => void }[] = [];
	constructor(
		private concurrency = 4,
		private maxQueued = 48,
	) {}
	async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
		signal.throwIfAborted();
		if (this.active >= this.concurrency) {
			if (this.queue.length >= this.maxQueued) throw Error("IMAGE_CACHE_BUSY");
			await new Promise<void>((resolve, reject) => {
				const item = {
					grant: () => {
						signal.removeEventListener("abort", cancel);
						resolve();
					},
				};
				const cancel = () => {
					const index = this.queue.indexOf(item);
					if (index >= 0) this.queue.splice(index, 1);
					reject(signal.reason);
				};
				this.queue.push(item);
				signal.addEventListener("abort", cancel, { once: true });
			});
		} else this.active++;
		try {
			signal.throwIfAborted();
			return await work();
		} finally {
			const next = this.queue.shift();
			if (next) next.grant();
			else this.active--;
		}
	}
}
