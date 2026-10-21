/** Owner convenience only. Every restore requires the current server-issued link metadata. */
export type ShareMetadata = {
	id: string;
	expiresAt: string;
	revokedAt: string | null;
};
const prefix = "pm:saved-share:v1:";
export const savedShareEvent = "pm:saved-shares-cleared";
const maxEntries = 32;
function storage() {
	return typeof window === "undefined" ? null : window.localStorage;
}
export function readSavedShare(
	projectId: string,
	share: ShareMetadata | null | undefined,
	origin: string,
	now = Date.now(),
): string {
	try {
		const store = storage();
		const raw = store?.getItem(prefix + projectId);
		if (!share || !raw || raw.length > 4096) return "";
		const saved = JSON.parse(raw);
		// Another tab may have rotated the link before its event reaches this tab.
		// Never delete that newer record just because this tab still has old metadata.
		if (saved.version !== 1 || saved.id !== share.id) return "";
		if (
			share.revokedAt ||
			!Number.isFinite(Date.parse(share.expiresAt)) ||
			Date.parse(share.expiresAt) <= now
		) {
			store?.removeItem(prefix + projectId);
			return "";
		}
		const url = new URL(saved.url);
		return url.origin === origin &&
			/^\/s\/[A-Za-z0-9_-]{43}$/.test(url.pathname) &&
			!url.search &&
			!url.hash
			? url.href
			: "";
	} catch {
		return "";
	}
}
export function saveShare(
	projectId: string,
	share: ShareMetadata,
	url: string,
): boolean {
	try {
		const store = storage();
		if (!store) return false;
		const keys = Array.from({ length: store.length }, (_, i) =>
			store.key(i),
		).filter((key): key is string => !!key?.startsWith(prefix));
		for (const key of keys) {
			try {
				const value = JSON.parse(store.getItem(key) || "null");
				if (!value || Date.parse(value.expiresAt) <= Date.now())
					store.removeItem(key);
			} catch {
				store.removeItem(key);
			}
		}
		const remaining = keys.filter(
			(key) => store.getItem(key) !== null && key !== prefix + projectId,
		);
		for (const key of remaining.slice(
			0,
			Math.max(0, remaining.length - maxEntries + 1),
		))
			store.removeItem(key);
		store.setItem(
			prefix + projectId,
			JSON.stringify({
				version: 1,
				id: share.id,
				expiresAt: share.expiresAt,
				url,
			}),
		);
		return true;
	} catch {
		return false;
	}
}
export function forgetSavedShare(projectId: string) {
	try {
		storage()?.removeItem(prefix + projectId);
	} catch {
		/* Storage can be disabled. */
	}
}
export function clearSavedShares() {
	try {
		const store = storage();
		if (!store) return;
		const keys = Array.from({ length: store.length }, (_, i) => store.key(i));
		for (const key of keys) if (key?.startsWith(prefix)) store.removeItem(key);
		window.dispatchEvent(new Event(savedShareEvent));
	} catch {
		/* Storage can be disabled. */
	}
}
