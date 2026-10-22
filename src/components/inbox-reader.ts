import type { InboxBundle } from "@/lib/issue-inbox";
import { unpackInbox } from "@/lib/issue-inbox";
import type { IssueCurrent, IssueSummary } from "@/lib/issues";
import type { ProjectUpdate } from "@/lib/project-events";
import { api, ApiError, seedApi } from "./api";
import { currentIssueUrl } from "./interaction-reads";

const MAX_ITEMS = 200, MAX_BYTES = 8 * 1024 * 1024;
const summary = ({ file: _file, target: _target, responses: _responses, reviews: _reviews, ...item }: IssueCurrent): IssueSummary => item;
export type InboxState = {
	items: IssueSummary[];
	views: ReadonlyMap<string, IssueCurrent>;
	counts: Record<string, number>;
	nextCursor: string | null;
	loaded: boolean;
	loading: boolean;
	error: string;
	epoch: number;
	unavailable: ReadonlySet<string>;
};
type Transport = (cursor: string | null, ids: string[] | null, signal: AbortSignal, limit?: number) => Promise<InboxBundle>;

/** One modal's bounded working set. Selection never starts a read for a prepared item. */
export class InboxReader {
	private state: InboxState = { items: [], views: new Map(), counts: {}, nextCursor: null, loaded: false, loading: false, error: "", epoch: 0, unavailable: new Set() };
	private listeners = new Set<() => void>();
	private views = new Map<string, IssueCurrent>();
	private sizes = new Map<string, number>();
	private bytes = 0;
	private protectedIds = new Set<string>();
	private queue = new Set<string>();
	private generation = 0;
	private changes = 0;
	private page: { controller: AbortController; promise: Promise<string[]>; cursor: string | null } | null = null;
	private updating: AbortController | null = null;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private expiry: ReturnType<typeof setTimeout> | undefined;
	private opened = false;
	private stopped = false;
	private refreshing = false;
	private stale = false;
	private saturated = false;
	private prepared = 0;
	private lastChecked = 0;
	constructor(private base: string, private invalid: () => void, private transport: Transport = (cursor, ids, signal, limit = 30) =>
		api<InboxBundle>(`${base}/inbox?${ids ? `ids=${ids.join(",")}` : `${cursor ? `cursor=${encodeURIComponent(cursor)}&` : ""}limit=${limit}`}`, "GET", undefined, { signal, cacheMs: 0 })) {}
	subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
	getSnapshot = () => this.state;
	activate() { this.stopped = false; }
	private publish(patch: Partial<InboxState> = {}) {
		this.state = { ...this.state, ...patch, views: new Map(this.views) };
		for (const listener of this.listeners) listener();
	}
	open() {
		if (this.stopped) return;
		this.opened = true; clearTimeout(this.expiry);
		for (const id of this.protectedIds) if (!this.views.has(id)) this.queue.add(id);
		if (!this.state.loaded) { this.stale = false; void this.readPage(null); }
		else if (this.stale || Date.now() - this.lastChecked > 30000) this.refresh();
		else { this.flushSoon(); this.pump(); }
	}
	close() {
		this.opened = false;
		// A normal selection never comes through here; closing cancels only this modal's reads.
		this.stale ||= !!this.page || !!this.updating;
		this.cancel();
		clearTimeout(this.expiry);
		this.expiry = setTimeout(() => this.clear(), 120000);
	}
	private cancel() {
		this.generation++; this.page?.controller.abort(); this.page = null;
		this.updating?.abort(); this.updating = null; this.refreshing = false;
		clearTimeout(this.timer); this.timer = undefined;
		this.publish({ loading: false });
	}
	clear(stop = false) {
		this.cancel(); clearTimeout(this.expiry); this.stopped = stop;
		this.views.clear(); this.sizes.clear(); this.bytes = 0; this.queue.clear();
		this.prepared = 0; this.saturated = false; this.lastChecked = 0;
		this.publish({ items: [], counts: {}, nextCursor: null, loaded: false, error: "", epoch: this.state.epoch + 1, unavailable: new Set() });
	}
	dispose() { this.opened = false; this.clear(true); this.listeners.clear(); }
	private remove(id: string) {
		this.bytes -= this.sizes.get(id) ?? 0; this.sizes.delete(id); this.views.delete(id);
	}
	private store(item: IssueCurrent) {
		const previous = this.views.get(item.id);
		if (previous && previous.revision > item.revision) return;
		this.remove(item.id);
		const size = JSON.stringify(item).length * 2;
		if (size > MAX_BYTES) return;
		while (this.views.size >= MAX_ITEMS || this.bytes + size > MAX_BYTES) {
			const old = [...this.views.keys()].find(id => !this.protectedIds.has(id));
			if (!old) { this.saturated = true; return; }
			this.remove(old); this.saturated = true;
		}
		this.views.set(item.id, item); this.sizes.set(item.id, size); this.bytes += size;
		seedApi(currentIssueUrl(this.base, item.id), item);
	}
	private merge(bundle: InboxBundle, countsValid: boolean) {
		const incoming = unpackInbox(bundle);
		const items = new Map(this.state.items.map(item => [item.id, item]));
		const unavailable = new Set(this.state.unavailable);
		for (const id of bundle.removedIds) { this.remove(id); items.delete(id); this.queue.delete(id); unavailable.add(id); }
		for (const item of incoming) {
			unavailable.delete(item.id);
			if (countsValid) this.queue.delete(item.id);
			this.store(item);
			const old = items.get(item.id);
			if (!old || old.revision <= item.revision) {
				if (item.closedAt) items.delete(item.id); else items.set(item.id, summary(item));
			}
		}
		this.publish({ items: [...items.values()], unavailable, ...(countsValid ? { counts: bundle.counts } : {}) });
		return incoming.map(item => item.id);
	}
	accept = (item: IssueCurrent) => {
		if (this.stopped) return;
		this.changes++;
		const old = this.state.items.find(row => row.id === item.id);
		const counts = { ...this.state.counts };
		if (old && old.revision > item.revision) return;
		if (old && !old.closedAt) counts[old.state] = Math.max(0, (counts[old.state] ?? 0) - 1);
		if (!item.closedAt) counts[item.state] = (counts[item.state] ?? 0) + 1;
		this.store(item);
		const items = this.state.items.filter(row => row.id !== item.id);
		if (!item.closedAt) items.push(summary(item));
		this.publish({ items, counts });
	};
	select(ids: string[]) {
		this.protectedIds = new Set(ids);
		const missing = ids.filter(id => !this.views.has(id));
		if (!missing.length) return;
		// An initial/continuation page may already contain the clicked task.
		const pending = this.page?.promise ?? Promise.resolve([]);
		void pending.then(() => {
			if (this.stopped) return;
			for (const id of missing) if (this.protectedIds.has(id) && !this.views.has(id)) this.queue.add(id);
			this.flushSoon();
		});
	}
	reload(ids: string[]) { for (const id of ids) this.queue.add(id); this.flushSoon(); }
	more() { if (this.state.nextCursor) void this.readPage(this.state.nextCursor, false); }
	private pump() {
		const selectedMissing = [...this.protectedIds].some(id => !this.views.has(id) && !this.state.unavailable.has(id));
		if (this.opened && !this.stopped && !this.page && !this.updating && !this.queue.size && !selectedMissing && !this.refreshing && !this.saturated && this.prepared < MAX_ITEMS && this.state.nextCursor)
			void this.readPage(this.state.nextCursor);
	}
	private failed(error: unknown) {
		if (error instanceof ApiError && error.status === 401) { this.clear(true); this.invalid(); return; }
		this.publish({ error: error instanceof Error ? error.message : "无法读取待办。" });
	}
	private readPage(cursor: string | null, continueReading = true): Promise<string[]> {
		if (this.page) return this.page.promise;
		if (!this.opened || this.stopped) return Promise.resolve([]);
		const controller = new AbortController(), generation = this.generation, changes = this.changes;
		this.publish({ loading: true, error: "" });
		const promise = (async () => {
			try {
				const limit = continueReading ? Math.max(1, Math.min(30, MAX_ITEMS - this.prepared)) : 30;
				const bundle = await this.transport(cursor, null, controller.signal, limit);
				if (generation !== this.generation || controller.signal.aborted) return [];
				const ids = this.merge(bundle, changes === this.changes);
				if (cursor || !this.state.loaded) this.prepared += ids.length;
				this.lastChecked = Date.now();
				this.publish({ nextCursor: bundle.nextCursor, loaded: true });
				return ids;
			} catch (error) {
				if (generation === this.generation && !controller.signal.aborted) this.failed(error);
				return [];
			} finally {
				if (generation === this.generation) {
					this.page = null; this.publish({ loading: false });
					this.flushSoon();
					if (continueReading && !this.state.error) this.pump();
				}
			}
		})();
		this.page = { controller, promise, cursor }; return promise;
	}
	private flushSoon() {
		if (!this.opened || this.stopped || this.updating || this.timer || !this.queue.size) return;
		this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 80);
	}
	private async fetchIds(ids: string[], signal: AbortSignal): Promise<InboxBundle[]> {
		try { return [await this.transport(null, ids, signal)]; }
		catch (error) {
			if (!(error instanceof ApiError) || error.status !== 413 || ids.length < 2) throw error;
			const at = Math.ceil(ids.length / 2);
			return [...await this.fetchIds(ids.slice(0, at), signal), ...await this.fetchIds(ids.slice(at), signal)];
		}
	}
	private async flush() {
		if (!this.opened || this.stopped || this.updating || !this.queue.size) return;
		const ids = [...this.queue].sort((a, b) => Number(this.protectedIds.has(b)) - Number(this.protectedIds.has(a))).slice(0, 30);
		for (const id of ids) this.queue.delete(id);
		const controller = new AbortController(), generation = this.generation, changes = this.changes;
		this.updating = controller;
		try {
			for (const bundle of await this.fetchIds(ids, controller.signal)) {
				if (generation !== this.generation || controller.signal.aborted) return;
				this.merge(bundle, changes === this.changes);
			}
			this.publish({ error: "" });
		} catch (error) {
			if (generation === this.generation && !controller.signal.aborted) { for (const id of ids) this.queue.add(id); this.failed(error); }
		} finally {
			if (generation === this.generation) {
				this.updating = null;
				if (!this.state.error) { this.flushSoon(); this.pump(); }
			}
		}
	}
	refresh() {
		this.stale = true;
		if (!this.opened || this.stopped || this.refreshing) return;
		this.refreshing = true;
		const generation = this.generation, known = [...this.views.keys()];
		const head = this.page?.cursor ? this.page.promise.then(() => this.readPage(null, false)) : this.readPage(null, false);
		void head.then(ids => {
			if (generation !== this.generation) return;
			this.refreshing = false; this.stale = false;
			for (const id of known) if (!ids.includes(id)) this.queue.add(id);
			this.flushSoon(); this.pump();
		});
	}
	updates(events: ProjectUpdate[]) {
		if (this.stopped) return;
		this.changes++;
		if (events.some(event => event.kind === "access.changed")) { this.clear(); if (this.opened) void this.readPage(null); return; }
		if (events.some(event => event.kind === "resync")) { this.refresh(); return; }
		for (const event of events) {
			if (event.kind === "issue.changed") {
				const view = this.views.get(event.entityId);
				if (!view || event.revision === null || view.revision < event.revision) this.queue.add(event.entityId);
			} else if (event.kind === "file.changed") {
				for (const view of this.views.values()) if (view.fileId === event.fileId || view.responses.some(response => response.attachments.some(file => file.id === event.fileId))) this.queue.add(view.id);
			} else if (event.kind === "annotation.changed") {
				for (const item of this.state.items) if (item.fileId === event.fileId) this.queue.add(item.id);
			}
		}
		if (this.queue.size > MAX_ITEMS) { this.queue.clear(); this.refresh(); }
		else this.flushSoon();
	}
}
