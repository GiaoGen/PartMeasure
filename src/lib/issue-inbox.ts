import type { CanonicalImage } from "./annotations";
import type { Evidence, IssueCurrent } from "./issues";

export type InboxBundle = {
	items: (Omit<IssueCurrent, "file" | "target"> & { targetKey: string | null })[];
	files: Record<string, Evidence>;
	images: Record<string, CanonicalImage>;
	targets: Record<string, Omit<NonNullable<IssueCurrent["target"]>, "image">>;
	counts: Record<string, number>;
	nextCursor: string | null;
	removedIds: string[];
};

/** Transport deduplication only: every target remains tied to its immutable revision. */
export function packInbox(items: IssueCurrent[], counts: Record<string, number>, nextCursor: string | null, removedIds: string[] = []): InboxBundle {
	const result: InboxBundle = { items: [], files: {}, images: {}, targets: {}, counts, nextCursor, removedIds };
	for (const { file, target, ...item } of items) {
		result.files[item.fileId] = file;
		const targetKey = target ? `${item.fileId}:${target.annotationRef.id}:${target.annotationRef.revision}` : null;
		if (target && targetKey) {
			const { image, ...snapshot } = target;
			result.images[item.fileId] = image;
			result.targets[targetKey] = snapshot;
		}
		result.items.push({ ...item, targetKey });
	}
	return result;
}

export function unpackInbox(bundle: InboxBundle): IssueCurrent[] {
	return bundle.items.map(({ targetKey, ...item }) => {
		const file = bundle.files[item.fileId], target = targetKey ? bundle.targets[targetKey] : null;
		const image = bundle.images[item.fileId];
		if (!file || (targetKey && (!target || !image))) throw Error("INBOX_BUNDLE_INCOMPLETE");
		return { ...item, file, target: target && image ? { ...target, image } : null };
	});
}
