import type { AnnotationDocument } from "@/lib/annotations";
import type { IssueCurrent, IssueCurrentPage } from "@/lib/issues";
import { api, ApiError, apiSessionGuard, readApiTransport, readApiWith, seedApi, type ReadOptions } from "./api";

type BatchItem = AnnotationDocument | IssueCurrent;
type Waiting = {
	id: string;
	signal: AbortSignal;
	resolve: (item: BatchItem) => void;
	reject: (error: unknown) => void;
	finish: () => void;
};
/** One bounded background batch at a time. Current-view batches have their own foreground lane. */
class ReadBatcher {
	private queues = new Map<string, Waiting[]>();
	private running = new Set<string>();
	private urgent = new Set<string>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	constructor(private resource: "file-layers" | "issue-views", private delay: number) {}
	foreground(base: string, id: string) {
		// Preserve ordinary field batching; bypass only a running background batch.
		if (this.running.has(base)) this.prioritize(base, id);
		else {
			const queue = this.queues.get(base);
			if (queue) this.queues.set(base, [...queue.filter(row => row.id === id), ...queue.filter(row => row.id !== id)]);
		}
	}
	prioritize(base: string, id: string) {
		const queue = this.queues.get(base);
		const selected = queue?.find(item => item.id === id && !item.signal.aborted);
		if (!queue || !selected) return; // Already on the wire or not requested by the gallery.
		const rest = queue.filter(item => item !== selected);
		if (this.urgent.has(base)) { this.queues.set(base, [selected, ...rest]); return; }
		if (rest.length) this.queues.set(base, rest); else this.queues.delete(base);
		this.urgent.add(base);
		void this.deliver(base, [selected]).finally(() => { this.urgent.delete(base); if (this.queues.has(base)) this.schedule(base); });
	}
	read(base: string, id: string, signal: AbortSignal): Promise<BatchItem> {
		signal.throwIfAborted();
		return new Promise((resolve, reject) => {
			const item: Waiting = { id, signal, resolve, reject, finish: () => signal.removeEventListener("abort", abort) };
			const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
			signal.addEventListener("abort", abort, { once: true });
			this.queues.set(base, [...(this.queues.get(base) ?? []), item]);
			this.schedule(base);
		});
	}
	private schedule(base: string) {
		if (this.running.has(base) || this.timers.has(base)) return;
		this.timers.set(base, setTimeout(() => { this.timers.delete(base); void this.flush(base); }, this.delay));
	}
	private async fetch(base: string, rows: Waiting[], signal: AbortSignal): Promise<BatchItem[]> {
		try {
			return (await readApiTransport<{ items: BatchItem[] }>(`${base}/${this.resource}?ids=${rows.map(r => r.id).join(",")}`, signal)).items;
		} catch (error) {
			// A removed file or response budget must not prevent other visible files from loading.
			if (rows.length < 2 || !(error instanceof ApiError) || ![404, 413].includes(error.status)) throw error;
			const result: BatchItem[] = [];
			for (const row of rows) {
				if (row.signal.aborted) continue;
				try { result.push(...await this.fetch(base, [row], signal)); }
				catch (failure) { row.reject(failure); }
			}
			return result;
		}
	}
	private async flush(base: string) {
		const pending = this.queues.get(base) ?? [];
		const alive = pending.filter(item => { if (item.signal.aborted) { item.finish(); return false; } return true; });
		const batch = alive.slice(0, 6), rest = alive.slice(6);
		if (rest.length) this.queues.set(base, rest); else this.queues.delete(base);
		if (!batch.length) return;
		this.running.add(base);
		try { await this.deliver(base, batch); }
		finally { this.running.delete(base); if (this.queues.has(base)) this.schedule(base); }
	}
	private async deliver(base: string, batch: Waiting[]) {
		const controller = new AbortController();
		const abort = () => { if (batch.every(row => row.signal.aborted)) controller.abort(); };
		for (const row of batch) row.signal.addEventListener("abort", abort);
		try {
			const items = await this.fetch(base, batch, controller.signal);
			for (const row of batch) {
				if (row.signal.aborted) continue;
				const item = items.find(value => ("image" in value ? value.image.id : value.id) === row.id);
				if (item) row.resolve(item); else row.reject(new ApiError("NOT_FOUND", 404));
			}
		} catch (error) { for (const row of batch) row.reject(error); }
		finally {
			for (const row of batch) { row.finish(); row.signal.removeEventListener("abort", abort); }
		}
	}
}
const gallery = new ReadBatcher("file-layers", 35);
const current = new ReadBatcher("issue-views", 12);
export const prioritizeLayers = (base: string, fileId: string) => gallery.prioritize(base, fileId);
export const currentIssueUrl = (base: string, id: string) => `${base}/issues/${id}/current`;
export const collaborationUrl = (base: string, fileId: string, annotationId: string) => `${base}/files/${fileId}/collaboration?annotationId=${annotationId}`;
export function readCurrentIssue(base: string, id: string, options: ReadOptions & { background?: boolean } = {}) {
	const result = readApiWith<IssueCurrent>(currentIssueUrl(base, id), signal => current.read(base, id, signal) as Promise<IssueCurrent>, options);
	if (!options.background) current.foreground(base, id);
	return result;
}
export function readLayers(base: string, fileId: string, options: ReadOptions = {}) {
	return readApiWith<AnnotationDocument>(`${base}/files/${fileId}/annotations`, signal => gallery.read(base, fileId, signal) as Promise<AnnotationDocument>, options);
}
export function seedCurrentIssues(base: string, issues: IssueCurrentPage) {
	return { ...issues, items: issues.items.map(issue => seedApi(currentIssueUrl(base, issue.id), issue)) };
}
export async function readCollaboration(base: string, fileId: string, annotationId: string, cursor: string | null, options: ReadOptions = {}) {
	const ensureSession = apiSessionGuard();
	const url = collaborationUrl(base, fileId, annotationId);
	const result = await api<{ issues: IssueCurrentPage }>(`${url}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, "GET", undefined, options);
	ensureSession();
	options.signal?.throwIfAborted();
	return seedCurrentIssues(base, result.issues);
}
export async function readInteractionDocument(base: string, fileId: string, annotationId: string, options: ReadOptions = {}) {
	const ensureSession = apiSessionGuard();
	const result = await api<{ document: AnnotationDocument; issues: IssueCurrentPage }>(`${base}/files/${fileId}/interaction?annotationId=${annotationId}`, "GET", undefined, options);
	ensureSession();
	options.signal?.throwIfAborted();
	// The complete aggregate has passed the API cache's identity and event fences before seeding.
	const issues = seedCurrentIssues(base, result.issues);
	seedApi(collaborationUrl(base, fileId, annotationId), { issues });
	return seedApi(`${base}/files/${fileId}/annotations`, result.document);
}
