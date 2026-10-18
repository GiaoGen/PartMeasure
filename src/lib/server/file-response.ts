import "server-only";
import { AppError } from "../policy";
import { satisfiableRange } from "../file-range";
import { privateBucket, storage } from "./storage";
type FileForTransfer = {
	mime: string;
	filename: string;
	byte_size: string;
	original_bytes: string;
	storage_key: string;
	original_key: string;
};
export async function fileResponse(
	req: Request,
	file: FileForTransfer,
	preview = false,
	original = false,
) {
	if (preview && (file.mime !== "image/webp" || original))
		throw new AppError("UNSUPPORTED_FORMAT", 415);
	const range = req.headers.get("range"),
		size = Number(original ? file.original_bytes : file.byte_size);
	const baseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
	if (range && !satisfiableRange(range, size))
		return new Response(null, {
			status: 416,
			headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
		});
	const { data, error } = await storage()
		.from(privateBucket)
		.createSignedUrl(original ? file.original_key : file.storage_key, 60);
	if (error || !data) throw new AppError("STORAGE_UNAVAILABLE", 503);
	const fetched = await fetch(data.signedUrl, {
		cache: "no-store",
		headers: range ? { Range: range } : {},
		signal: AbortSignal.any([req.signal, AbortSignal.timeout(60000)]),
	});
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
