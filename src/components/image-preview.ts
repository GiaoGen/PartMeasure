import { readCached } from "./api";

/** Reuse authorized list metadata; this hint never grants permission to fetch bytes. */
export function imagePreviewHint(canonicalUrl: string) {
	const match = canonicalUrl.match(
		/^(\/api\/(?:guest\/)?projects\/[^/]+)\/files\/([^/]+)\/preview$/,
	);
	if (!match) return undefined;
	const list = readCached<{
		items: {
			id: string;
			previewVersion?: string;
			thumbnail?: { version: string } | null;
		}[];
	}>(`${match[1]}/files`);
	const file = list?.items.find((item) => item.id === match[2]);
	const hash = file?.previewVersion?.split(":")[0];
	if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return undefined;
	return {
		hash,
		preview: file?.thumbnail
			? { src: `${canonicalUrl}?variant=640`, version: file.thumbnail.version }
			: undefined,
	};
}
