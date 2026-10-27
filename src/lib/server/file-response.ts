import "server-only";
import { AppError } from "../policy";
import { byteRange, satisfiableRange } from "../file-range";
import { privateBucket, storage } from "./storage";
import { timed } from "./timing";
import { createHash } from "node:crypto";
import { ThumbnailCache } from "./thumbnail-cache";
import { TransferBudget } from "./transfer-budget";
import { readWithSignal } from "./bounded-stream";
const thumbnails = new ThumbnailCache();
const transfers = new TransferBudget();
type FileForTransfer = {
	mime: string;
	filename: string;
	byte_size: string;
	original_bytes: string;
	storage_key: string;
	original_key: string;
	sha256: string;
	image_cache_scope?: string | null;
	transfer_scope?: string;
};
export async function fileResponse(
	req: Request,
	authorize: () => Promise<FileForTransfer>,
	preview = false,
	original = false,
) {
	const file = await authorize();
	req.signal.throwIfAborted();
	const size = Number(original ? file.original_bytes : file.byte_size);
	if (!Number.isSafeInteger(size) || size <= 0) throw new AppError("STORAGE_UNAVAILABLE", 503);
	const release = transfers.acquire(file.transfer_scope ?? "unscoped");
	const abort = new AbortController();
	const signal = AbortSignal.any([req.signal, abort.signal]);
	const timer = setTimeout(() => abort.abort(new AppError("DEPENDENCY_TIMEOUT", 503)), 60000);
	timer.unref?.();
	let source: Response | undefined;
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
	let ended = false, handedOff = false;
	const finish = () => {
		if (ended) return;
		ended = true;
		clearTimeout(timer);
		signal.removeEventListener("abort", interrupted);
		abort.abort();
		if (reader) void reader.cancel().catch(() => {}).finally(() => reader?.releaseLock());
		else void source?.body?.cancel().catch(() => {});
		release();
	};
	const interrupted = () => {
		sink?.error(new Error("PRIVATE_DOWNLOAD_INTERRUPTED"));
		finish();
	};
	signal.addEventListener("abort", interrupted, { once: true });
	let checkedAt = Date.now(), sinceCheck = 0;
	const recheck = async () => {
		signal.throwIfAborted();
		const current = await authorize();
		signal.throwIfAborted();
		if (current.storage_key !== file.storage_key || current.original_key !== file.original_key ||
			current.sha256 !== file.sha256 || current.byte_size !== file.byte_size || current.original_bytes !== file.original_bytes)
			throw new AppError("IMAGE_VERSION_CONFLICT", 409);
		checkedAt = Date.now(); sinceCheck = 0;
	};
	try {
		signal.throwIfAborted();
		source = await prepareFileResponse(new Request(req, { signal }), file, preview, original);
		// A shared thumbnail load or Storage fetch may outlive revocation. Check again before returning bytes.
		await recheck();
		if (!source.body || source.status === 416) return source;
		const range = req.headers.get("range");
		const span = range ? byteRange(range, size) : null;
		const expected = source.status === 206 ? span?.bytes : size;
		if (![200, 206].includes(source.status) || !expected ||
			(source.status === 206 && source.headers.get("content-range") !== `bytes ${span?.start}-${span?.end}/${size}`) ||
			(source.headers.has("content-length") && source.headers.get("content-length") !== String(expected)))
			throw new AppError("STORAGE_UNAVAILABLE", 503);
		reader = source.body.getReader();
		const input = reader;
		let received = 0;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) { sink = controller; },
			async pull(controller) {
				let phase = "read";
				let nextBytes = 0, upstreamDone = false;
				try {
					const next = await readWithSignal(input, signal);
					nextBytes = next.value?.length ?? 0; upstreamDone = next.done;
					signal.throwIfAborted();
					phase = "reauthorize";
					if (Date.now() - checkedAt >= 5000 || sinceCheck >= 8 * 1024 * 1024) await recheck();
					phase = "length";
					if (next.done) {
						if (received !== expected) throw new AppError("STORAGE_UNAVAILABLE", 503);
						controller.close(); finish();
					} else {
						if (received + next.value.length > expected) throw new AppError("STORAGE_UNAVAILABLE", 503);
						received += next.value.length; sinceCheck += next.value.length;
						controller.enqueue(next.value);
					}
				} catch (error) {
					if (process.env.PM_SERVER_TIMING === "1") {
						const known = ["AUTH_REQUIRED", "LINK_UNAVAILABLE", "NOT_FOUND", "IMAGE_VERSION_CONFLICT", "STORAGE_UNAVAILABLE", "DATABASE_TIMEOUT", "DATABASE_BUSY", "DEPENDENCY_UNAVAILABLE", "DEPENDENCY_TIMEOUT"];
						const contextUnavailable = error instanceof Error && /cookies|request scope|request store/i.test(error.message);
						console.warn(JSON.stringify({ event: "private_transfer_interrupted", phase,
							code: error instanceof AppError && known.includes(error.code) ? error.code : contextUnavailable ? "REQUEST_CONTEXT_UNAVAILABLE" : "STREAM_INTERRUPTED",
							receivedBytes: received, expectedBytes: expected, nextBytes, upstreamDone, aborted: signal.aborted }));
					}
					if (!ended) controller.error(new Error("PRIVATE_DOWNLOAD_INTERRUPTED"));
					finish();
				}
			},
			cancel() { finish(); },
		}, { highWaterMark: 0 });
		const headers = new Headers(source.headers);
		headers.set("Content-Length", String(expected));
		handedOff = true;
		return new Response(stream, { status: source.status, headers });
	} finally {
		if (!handedOff) {
			finish();
			// A shared cache load may settle after cancellation released the lease.
			if (source?.body && !source.body.locked) void source.body.cancel().catch(() => {});
		}
	}
}
async function prepareFileResponse(
	req: Request,
	file: FileForTransfer,
	preview = false,
	original = false,
) {
	// Called only inside fileResponse's fresh authorization and transfer lease.
	if (preview && (file.mime !== "image/webp" || original))
		throw new AppError("UNSUPPORTED_FORMAT", 415);
	const range = req.headers.get("range"),
		size = Number(original ? file.original_bytes : file.byte_size);
	const baseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie", ...(preview && file.image_cache_scope ? { "X-PM-Image-Namespace": file.image_cache_scope, "X-PM-Image-Version": file.sha256 } : {}) };
	if (range && !satisfiableRange(range, size))
		return new Response(null, {
			status: 416,
			headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
		});
	if (
		req.method === "GET" &&
		preview &&
		!original &&
		!range &&
		size > 0 &&
		size <= 262144 &&
		/\/thumb-(320|640)(?:-[a-f0-9]{64})?\.webp$/.test(file.storage_key) &&
		/^[0-9a-f]{64}$/.test(file.sha256)
	) {
		const bytes = await thumbnails.read(
			`${process.env.NEXT_PUBLIC_SUPABASE_URL}:${privateBucket}:${file.storage_key}:${file.sha256}:${size}`,
			async () => {
				const fetched = await privateFetch(req, file, false, null);
				if (fetched.status !== 200) {
					await fetched.body?.cancel();
					throw new AppError("STORAGE_UNAVAILABLE", 503);
				}
				const reader = fetched.body?.getReader();
				if (!reader) throw new AppError("STORAGE_UNAVAILABLE", 503);
				const data = new Uint8Array(size);
				let offset = 0;
				try {
					while (true) {
						const part = await readWithSignal(reader, req.signal);
						if (part.done) break;
						if (offset + part.value.length > size)
							throw new AppError("STORAGE_UNAVAILABLE", 503);
						data.set(part.value, offset);
						offset += part.value.length;
					}
					if (
						offset !== size ||
						createHash("sha256").update(data).digest("hex") !== file.sha256
					)
						throw new AppError("STORAGE_UNAVAILABLE", 503);
					return data;
				} catch (e) {
					void reader.cancel().catch(() => {});
					throw e;
				} finally {
					reader.releaseLock();
				}
			},
		);
		if (bytes)
			return new Response(bytes.buffer as ArrayBuffer, {
				headers: {
					...baseHeaders,
					"Content-Type": "image/webp",
					"Content-Length": String(bytes.length),
					"Accept-Ranges": "bytes",
					"X-Content-Type-Options": "nosniff",
					"Content-Disposition": "inline",
				},
			});
	}
	const fetched = await privateFetch(req, file, original, range);
	if (!fetched.ok || !fetched.body) {
		await fetched.body?.cancel();
		if (fetched.status === 416)
			return new Response(null, {
				status: 416,
				headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
			});
		throw new AppError("STORAGE_UNAVAILABLE", 503);
	}
	const downloadName =
		!original && file.mime === "image/webp"
			? file.filename.replace(/\.[^.]+$/, ".webp")
			: file.filename;
	const headers = new Headers({
		...baseHeaders,
		"Content-Type": original ? "application/octet-stream" : file.mime,
		"X-Content-Type-Options": "nosniff",
		"Content-Disposition": `${preview ? "inline" : "attachment"}; filename="download"; filename*=UTF-8''${encodeURIComponent(downloadName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
	});
	for (const key of ["content-length", "content-range", "accept-ranges"]) {
		const value = fetched.headers.get(key);
		if (value) headers.set(key, value);
	}
	if (!range && fetched.status === 200 && !headers.has("Content-Length"))
		headers.set("Content-Length", String(size));
	return new Response(fetched.body, { status: fetched.status, headers });
}
async function privateFetch(
	req: Request,
	file: FileForTransfer,
	original: boolean,
	range: string | null,
) {
	const { data, error } = await timed("storage_sign", () =>
		storage(req.signal)
			.from(privateBucket)
			.createSignedUrl(original ? file.original_key : file.storage_key, 60),
	);
	if (error || !data) throw new AppError("STORAGE_UNAVAILABLE", 503);
	return timed("storage_fetch", () =>
		fetch(data.signedUrl, {
			cache: "no-store",
			headers: range ? { Range: range } : {},
			signal: AbortSignal.any([req.signal, AbortSignal.timeout(60000)]),
		}),
	);
}
