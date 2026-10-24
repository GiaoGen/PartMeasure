import { CV_MAX_SIDE, CV_WORKER_URL, type CvRequest, type CvResponse, type CvResult } from "./protocol";

export type CvWorker = Pick<Worker, "onmessage" | "onerror" | "onmessageerror" | "postMessage" | "terminate">;
const aborted = () => new DOMException("Cancelled", "AbortError");
/** One image-editor-owned worker, one in-flight request, no image cache. */
export class CvClient {
	private worker: CvWorker | null = null;
	private ready: Promise<void> | null = null;
	private startup: { resolve: () => void; reject: (e: Error) => void } | null = null;
	private pending: { id: number; resolve: (r: CvResult) => void; reject: (e: Error) => void } | null = null;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private idle: ReturnType<typeof setTimeout> | undefined;
	private generation = 0;
	private running = false;
	constructor(private readonly create: () => CvWorker = () => new Worker(CV_WORKER_URL)) {}
	cancel(reason: Error = aborted()) {
		this.generation++;
		this.running = false;
		clearTimeout(this.timer); clearTimeout(this.idle);
		this.startup?.reject(reason); this.pending?.reject(reason);
		this.startup = null; this.pending = null; this.ready = null;
		if (this.worker) { this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null; this.worker.terminate(); }
		this.worker = null;
	}
	private start() {
		if (this.ready) return this.ready;
		this.ready = new Promise<void>((resolve, reject) => { this.startup = { resolve, reject }; });
		const ready = this.ready;
		try {
			const worker = this.create(); this.worker = worker;
			worker.onmessage = (event: MessageEvent<CvResponse>) => {
				if (this.worker !== worker) return;
				const data = event.data;
				if (data.kind === "ready") { clearTimeout(this.timer); this.startup?.resolve(); this.startup = null; }
				else if (data.kind === "result" && data.id === this.pending?.id) {
					clearTimeout(this.timer); const pending = this.pending; this.pending = null; pending.resolve(data.result);
					this.idle = setTimeout(() => this.cancel(), 45000);
				} else if (data.kind === "error" && (data.id === undefined || data.id === this.pending?.id)) this.cancel(Error(data.message));
			};
			worker.onerror = worker.onmessageerror = () => { if (this.worker === worker) this.cancel(Error("CV_WORKER_FAILED")); };
			this.timer = setTimeout(() => this.cancel(Error("CV_LOAD_TIMEOUT")), 20000);
		} catch { this.cancel(Error("CV_WORKER_UNAVAILABLE")); }
		return ready;
	}
	async run(request: Omit<CvRequest, "id">, signal: AbortSignal): Promise<CvResult> {
		if (signal.aborted) throw aborted();
		if (this.running) throw Error("CV_BUSY");
		if (!Number.isInteger(request.width) || !Number.isInteger(request.height) || request.width < 1 || request.height < 1 || request.width > CV_MAX_SIDE || request.height > CV_MAX_SIDE || request.rgba.byteLength !== request.width * request.height * 4 || request.drafts.length > 1) throw Error("CV_IMAGE_BUDGET");
		clearTimeout(this.idle);
		const id = ++this.generation;
		this.running = true;
		const abort = () => this.cancel();
		signal.addEventListener("abort", abort, { once: true });
		try {
			await this.start();
			if (signal.aborted || id !== this.generation || !this.worker) throw aborted();
			return await new Promise<CvResult>((resolve, reject) => {
				this.pending = { id, resolve, reject };
				this.timer = setTimeout(() => this.cancel(Error("CV_COMPUTE_TIMEOUT")), 8000);
				try { this.worker?.postMessage({ ...request, id }, [request.rgba]); }
				catch { this.cancel(Error("CV_WORKER_FAILED")); }
			});
		} finally { signal.removeEventListener("abort", abort); if (this.generation === id) this.running = false; }
	}
}
