import "server-only";
import { AppError } from "../policy";
import { satisfiableRange } from "../file-range";
import { privateBucket, storage } from "./storage";
import { timed } from "./timing";
import { createHash } from "node:crypto";
import { ThumbnailCache } from "./thumbnail-cache";
const thumbnails = new ThumbnailCache();
type FileForTransfer = {
	mime: string;
	filename: string;
	byte_size: string;
	original_bytes: string;
	storage_key: string;
	original_key: string;
	sha256: string;
	image_cache_scope?: string | null;
};
export async function fileResponse(
	req: Request,
	authorize: () => Promise<FileForTransfer>,
	preview = false,
	original = false,
) {
	// Mandatory fresh authorization, including on a byte-cache hit or singleflight join.
	const file = await authorize();
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
						const part = await reader.read();
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
					await reader.cancel().catch(() => {});
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
	const reader = fetched.body.getReader();
	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await reader.read();
				if (next.done) controller.close();
				else controller.enqueue(next.value);
			} catch {
				controller.error(new Error("PRIVATE_DOWNLOAD_INTERRUPTED"));
			}
		},
		async cancel() {
			await reader.cancel().catch(() => {});
		},
	});
	return new Response(stream, { status: fetched.status, headers });
}
async function privateFetch(
	req: Request,
	file: FileForTransfer,
	original: boolean,
	range: string | null,
) {
	const { data, error } = await timed("storage_sign", () =>
		storage()
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
