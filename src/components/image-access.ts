import type { ImageAccess } from "@/lib/image-access";
import { ApiError, readApiTransport } from "./api";
type Reader = { id: string; signal: AbortSignal; resolve: (result: ImageAccess) => void; reject: (error: unknown) => void };
const queues = new Map<string, Reader[]>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
export function imageResource(url: string) {
	const parsed = new URL(url, "http://image.invalid");
	const match = parsed.pathname.match(/^(\/api\/(?:guest\/)?projects\/[a-f0-9-]{36})\/files\/([a-f0-9-]{36})\/preview$/i);
	if (!match || [...parsed.searchParams.keys()].some(key => key !== "variant")) return undefined;
	const value = parsed.searchParams.get("variant");
	if (value !== null && !["320", "640"].includes(value)) return undefined;
	return { base: match[1] as string, fileId: match[2] as string, variant: value === null ? null : Number(value), resource: parsed.pathname };
}
export function authorizeImage(base: string, fileId: string, signal: AbortSignal): Promise<ImageAccess> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const readers = queues.get(base) ?? [];
		if (readers.length >= 64) { reject(new ApiError("DEPENDENCY_UNAVAILABLE", 503)); return; }
		readers.push({ id: fileId, signal, resolve, reject });
		queues.set(base, readers);
		if (!timers.has(base)) timers.set(base, setTimeout(() => { timers.delete(base); void flush(base); }, 12));
	});
}
async function flush(base: string) {
	const queue = queues.get(base) ?? [];
	const batch = queue.slice(0, 30), rest = queue.slice(30);
	if (rest.length) { queues.set(base, rest); timers.set(base, setTimeout(() => { timers.delete(base); void flush(base); }, 12)); }
	else queues.delete(base);
	const alive = batch.filter(row => { if (row.signal.aborted) { row.reject(row.signal.reason); return false; } return true; });
	if (!alive.length) return;
	const controller = new AbortController();
	const abort = () => { if (alive.every(row => row.signal.aborted)) controller.abort(); };
	for (const row of alive) row.signal.addEventListener("abort", abort);
	try {
		const ids = [...new Set(alive.map(row => row.id))];
		const result = await readApiTransport<ImageAccess>(`${base}/image-access?ids=${ids.join(",")}`, controller.signal);
		if (!/^[a-f0-9]{64}$/.test(result.namespace)) throw new ApiError("DEPENDENCY_UNAVAILABLE", 503);
		for (const row of alive) { if (row.signal.aborted) row.reject(row.signal.reason); else row.resolve(result); }
	} catch (error) { for (const row of alive) row.reject(error); }
	finally { for (const row of alive) row.signal.removeEventListener("abort", abort); }
}
