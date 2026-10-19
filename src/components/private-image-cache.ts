import {
	ApiError,
	clearApiSession,
	onApiSessionCleared,
	onProjectCacheInvalidated,
} from "./api";
import { PrivateImageCache, boundedImageBlob } from "./image-memory";
export { PrivateImageCache } from "./image-memory";
import { ImageTransfers } from "./image-transfers";
const images = new PrivateImageCache();
const transfers = new ImageTransfers();
onApiSessionCleared(() => images.clear());
onProjectCacheInvalidated((base, updates) => {
	if (base.startsWith("/api/guest/") && updates.some((e) => e.kind === "access.changed"))
		images.invalidate((key) => key.startsWith(`${base}/`));
	else
		for (const e of updates)
			if (e.kind === "file.changed" && e.state !== "ready" && e.fileId)
				images.invalidate((key) => key.startsWith(`${base}/files/${e.fileId}/`));
});
export const discardPrivateImage = (url: string, version: string) =>
	images.invalidate((key) => key === `${url}:${version}`);
export async function privateImage(url: string, version: string) {
	return images.acquire(`${url}:${version}`, async (signal, reserve) =>
		transfers.run(signal, async () => {
			const response = await fetch(url, {
				cache: "no-store",
				signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
			});
			if (response.status === 401) clearApiSession();
			if (!response.ok) throw new ApiError("IMAGE_NOT_READY", response.status);
			if (response.headers.get("content-type")?.split(";")[0] !== "image/webp")
				throw Error("IMAGE_FORMAT");
			return boundedImageBlob(
				response,
				signal,
				reserve,
				/\?variant=(320|640)$/.test(url) ? 262144 : 80 * 1024 * 1024,
			);
		}),
	);
}
