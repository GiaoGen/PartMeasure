/** Only encoded bytes and eviction metadata. Access manifests/credentials never go to IndexedDB. */
export type StoredImage = { key: string; namespace: string; version: string; resource: string; base: string; blob: Blob; bytes: number; created: number; accessed: number };
export interface ImageStore {
	has(version: string): Promise<boolean>;
	get(key: string): Promise<StoredImage | undefined>;
	put(value: StoredImage): Promise<void>;
	remove(matches: (value: StoredImage) => boolean): Promise<void>;
}
export const diskLimits = { bytes: 96 * 1024 * 1024, entries: 48, age: 24 * 60 * 60 * 1000, itemBytes: 32 * 1024 * 1024 };
export function retainedImages(rows: StoredImage[], incoming: StoredImage, now: number) {
	const keep = rows.filter(row => row.key !== incoming.key && row.created + diskLimits.age > now).sort((a, b) => b.accessed - a.accessed);
	let bytes = incoming.bytes;
	return [incoming, ...keep.filter(row => { if (bytes + row.bytes > diskLimits.bytes) return false; bytes += row.bytes; return true; })].slice(0, diskLimits.entries);
}
export class IndexedImageStore implements ImageStore {
	private unavailable = false;
	private async open(): Promise<IDBDatabase> {
		if (this.unavailable || typeof indexedDB === "undefined") throw Error("IMAGE_STORAGE_UNAVAILABLE");
		return new Promise((resolve, reject) => {
			let finished = false;
			const fail = () => { finished = true; this.unavailable = true; clearTimeout(timer); reject(Error("IMAGE_STORAGE_UNAVAILABLE")); };
			const timer = setTimeout(fail, 1500);
			const request = indexedDB.open("pm-private-image-bytes-v1", 1);
			request.onupgradeneeded = () => {
				const store = request.result.createObjectStore("images", { keyPath: "key" });
				store.createIndex("version", "version");
			};
			request.onerror = request.onblocked = fail;
			request.onsuccess = () => { clearTimeout(timer); if (finished) request.result.close(); else { finished = true; resolve(request.result); } };
		});
	}
	private async transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
		const db = await this.open();
		try {
			return await new Promise<T>((resolve, reject) => {
				const transaction = db.transaction("images", mode);
				const timer = setTimeout(() => { transaction.abort(); }, 5000);
				let value: T;
				transaction.oncomplete = () => { clearTimeout(timer); resolve(value); };
				transaction.onerror = transaction.onabort = () => { clearTimeout(timer); this.unavailable = true; reject(Error("IMAGE_STORAGE_UNAVAILABLE")); };
				work(transaction.objectStore("images"), result => { value = result; });
			});
		} finally { db.close(); }
	}
	async has(version: string) {
		return this.transaction<boolean>("readonly", (store, result) => {
			const request = store.index("version").getKey(version);
			request.onsuccess = () => result(request.result !== undefined);
		});
	}
	async get(key: string) {
		return this.transaction<StoredImage | undefined>("readonly", (store, result) => {
			const request = store.get(key);
			request.onsuccess = () => result(request.result);
		});
	}
	async put(value: StoredImage) {
		await this.transaction<void>("readwrite", (store, result) => {
			const request = store.getAll();
			request.onsuccess = () => {
				const rows = request.result as StoredImage[];
				const keep = retainedImages(rows, value, Date.now());
				const ids = new Set(keep.map(row => row.key));
				for (const row of rows) if (!ids.has(row.key)) store.delete(row.key);
				store.put(value); result(undefined);
			};
		});
	}
	async remove(matches: (value: StoredImage) => boolean) {
		await this.transaction<void>("readwrite", (store, result) => {
			const request = store.openCursor();
			request.onsuccess = () => { const cursor = request.result; if (cursor) { if (matches(cursor.value)) cursor.delete(); cursor.continue(); } else result(undefined); };
		});
	}
}
export class PersistentImages {
	private epoch = 0;
	private operations: Promise<unknown> = Promise.resolve();
	constructor(private store: ImageStore = new IndexedImageStore()) {}
	private run<T>(work: () => Promise<T>): Promise<T> {
		const pending = this.operations.then(work, work);
		this.operations = pending.catch(() => {});
		return pending;
	}
	guard() { const epoch = this.epoch; return () => epoch === this.epoch; }
	async has(version: string) { try { return await this.run(() => this.store.has(version)); } catch { return false; } }
	async reuse(version: string, authorize: () => Promise<{ namespace: string; bytes: number }>, valid: () => boolean, reserve: (bytes: number) => void) {
		if (!await this.has(version) || !valid()) return undefined;
		// Authorization failure propagates: it must never turn into an offline/private-cache fallback.
		const grant = await authorize();
		if (!valid()) return undefined;
		reserve(grant.bytes);
		return this.read(grant.namespace, version, grant.bytes, valid);
	}
	async read(namespace: string, version: string, bytes: number, valid: () => boolean) {
		if (!valid()) return undefined;
		try {
			const value = await this.run(() => valid() ? this.store.get(`${namespace}:${version}`) : Promise.resolve(undefined));
			if (!valid() || !value || value.created + diskLimits.age <= Date.now() || value.namespace !== namespace || value.version !== version || value.bytes !== bytes || value.blob.size !== bytes) return undefined;
			if (await blobHash(value.blob) !== version || !valid()) { void this.invalidate(row => row.key === value.key); return undefined; }
			void this.run(() => valid() ? this.store.put({ ...value, accessed: Date.now() }) : Promise.resolve()).catch(() => {});
			return value.blob;
		} catch { return undefined; }
	}
	async save(namespace: string, version: string, resource: string, base: string, blob: Blob, valid: () => boolean) {
		if (!valid() || blob.size < 1 || blob.size > diskLimits.itemBytes || !/^[a-f0-9]{64}$/.test(namespace)) return;
		try {
			if (await blobHash(blob) !== version || !valid()) return;
			const now = Date.now();
			await this.run(() => valid() ? this.store.put({ key: `${namespace}:${version}`, namespace, version, resource, base, blob, bytes: blob.size, created: now, accessed: now }) : Promise.resolve());
		} catch { /* Storage quota/private mode must never break the image. */ }
	}
	async invalidate(matches: (value: StoredImage) => boolean) {
		this.epoch++;
		try { await this.run(() => this.store.remove(matches)); } catch { /* Fresh authorization still gates every future read. */ }
	}
}
export async function blobHash(blob: Blob) {
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map(value => value.toString(16).padStart(2, "0")).join("");
}
