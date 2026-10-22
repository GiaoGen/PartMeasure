import {
	ApiError,
	clearApiSession,
	onApiSessionCleared,
	onProjectCacheInvalidated,
	apiSessionGuard,
} from "./api";
import { PrivateImageCache, boundedImageBlob } from "./image-memory";
export { PrivateImageCache } from "./image-memory";
import { ImageTransfers } from "./image-transfers";
import { PersistentImages } from "./persistent-images";
import { authorizeImage, imageResource } from "./image-access";
const images = new PrivateImageCache();
const transfers = new ImageTransfers();
const disk = new PersistentImages();
const invalidationListeners = new Set<(prefix: string) => void>();
export function onPrivateImageInvalidated(listener: (prefix: string) => void) {
	invalidationListeners.add(listener);
	return () => { invalidationListeners.delete(listener); };
}
let channel: BroadcastChannel | undefined;
function invalidate(base?: string, fileId?: string, broadcast = true) {
	const prefix = base ? fileId ? `${base}/files/${fileId}/` : `${base}/` : "";
	images.invalidate(key => key.startsWith(prefix));
	for (const listener of invalidationListeners) listener(prefix);
	void disk.invalidate(row => row.resource.startsWith(prefix));
	if (broadcast) channel?.postMessage({ base, fileId });
}
function listen() {
	if (channel || typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
	channel = new BroadcastChannel("pm-private-image-cache-v1");
	channel.onmessage = event => {
		const value = event.data;
		if (!value || (value.base !== undefined && (typeof value.base !== "string" || !/^\/api\/(?:guest\/)?projects\/[a-f0-9-]{36}$/.test(value.base))) || (value.fileId !== undefined && (typeof value.fileId !== "string" || !/^[a-f0-9-]{36}$/.test(value.fileId)))) return;
		invalidate(value.base, value.fileId, false);
	};
}
onApiSessionCleared(reason => { images.clear(); if (reason === "identity") invalidate(); });
onProjectCacheInvalidated((base, updates) => {
	if (updates.some(e => base.startsWith("/api/guest/") && e.kind === "access.changed"))
		invalidate(base);
	else
		for (const e of updates)
			if (e.kind === "file.changed" && e.state !== "ready" && e.fileId)
				invalidate(base, e.fileId);
});
export const discardPrivateImage = (url: string, version: string) => {
	images.invalidate(key => key === `${url}:${version}`);
	for (const listener of invalidationListeners) listener(`${url}:${version}`);
	const resource = imageResource(url);
	if (resource) void disk.invalidate(row => row.resource === resource.resource && row.version === version.replace(/:n1$/, ""));
};
export const cachedPrivateImage = (url: string, version: string) => images.cached(`${url}:${version}`);
export async function privateImage(url: string, version: string, consumerSignal?: AbortSignal) {
	listen();
	return images.acquire(`${url}:${version}`, async (signal, reserve) => {
		const ensureSession = apiSessionGuard();
		const unchanged = disk.guard();
		const valid = () => { try { ensureSession(); return unchanged() && !signal.aborted; } catch { return false; } };
		const resource = imageResource(url), hash = version.replace(/:n1$/, "");
		if (resource && /^[a-f0-9]{64}$/.test(hash)) {
			// Looking up presence reads an index key only. Blob bytes are fetched after this fresh request.
			const local = await disk.reuse(hash, async () => {
				const access = await authorizeImage(resource.base, resource.fileId, signal);
				ensureSession(); signal.throwIfAborted();
				const file = access.items.find(item => item.id === resource.fileId);
				if (!file) throw new ApiError("NOT_FOUND", 404);
				const permitted = file.images.find(image => image.variant === resource.variant && image.version === hash);
				if (!permitted) throw new ApiError("IMAGE_VERSION_CONFLICT", 409);
				return { namespace: access.namespace, bytes: permitted.bytes };
			}, valid, reserve);
			if (local) return local;
		}
		return transfers.run(signal, async () => {
			const response = await fetch(url, {
				cache: "no-store",
				signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
			});
			if (response.status === 401) clearApiSession();
			if (!response.ok) throw new ApiError("IMAGE_NOT_READY", response.status);
			if (response.headers.get("content-type")?.split(";")[0] !== "image/webp")
				throw Error("IMAGE_FORMAT");
			const serverHash = response.headers.get("x-pm-image-version"), namespace = response.headers.get("x-pm-image-namespace");
			if (serverHash && serverHash !== hash) { await response.body?.cancel(); throw new ApiError("IMAGE_VERSION_CONFLICT", 409); }
			const blob = await boundedImageBlob(
				response,
				signal,
				reserve,
				/\?variant=(320|640)$/.test(url) ? 262144 : 80 * 1024 * 1024,
			);
			if (resource && namespace && serverHash === hash) void disk.save(namespace, hash, resource.resource, resource.base, blob, valid);
			return blob;
		});
	}, consumerSignal,
	);
}
