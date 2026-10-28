import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export async function streamObjectReadback(options: {
	endpoint: string; apiKey: string; bucket: string; key: string; bytes: number; sha256: string;
	signal: AbortSignal; onProgress?: (bytes: number) => void; fetcher?: typeof fetch;
}) {
	options.signal.throwIfAborted();
	assert.match(options.endpoint, /^https:\/\/[a-z]{20}\.supabase\.co$/);
	assert.equal(options.bucket, "partmeasure-private");
	assert.match(options.key, /^[a-f0-9-]{36}\/[a-f0-9-]{36}\/(?:source|canonical\.webp|thumb-(?:320|640)(?:-[a-f0-9]{64})?\.webp)$/);
	assert.ok(options.bytes > 0 && options.bytes <= 100 * 1024 ** 2);
	const controller = new AbortController();
	const total = setTimeout(() => controller.abort(Error("READBACK_TOTAL_TIMEOUT")), 10 * 60 * 1000);
	let idle = setTimeout(() => controller.abort(Error("READBACK_IDLE_TIMEOUT")), 45000);
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	const started = performance.now(), hash = createHash("sha256"); let bytes = 0;
	try {
		const response = await (options.fetcher ?? fetch)(`${options.endpoint}/storage/v1/object/authenticated/${options.bucket}/${options.key}`, {
			headers: { apikey: options.apiKey, Authorization: `Bearer ${options.apiKey}` }, redirect: "error", cache: "no-store",
			signal: AbortSignal.any([options.signal, controller.signal]),
		});
		assert.equal(response.status, 200, `READBACK_HTTP_${response.status}`);
		if (response.headers.has("content-length")) assert.equal(Number(response.headers.get("content-length")), options.bytes, "READBACK_DECLARED_SIZE_MISMATCH");
		assert.ok(response.body, "READBACK_BODY_MISSING"); reader = response.body.getReader();
		for (;;) {
			const part = await reader.read(); if (part.done) break;
			clearTimeout(idle); idle = setTimeout(() => controller.abort(Error("READBACK_IDLE_TIMEOUT")), 45000);
			bytes += part.value.length; assert.ok(bytes <= options.bytes, "READBACK_SIZE_LIMIT"); hash.update(part.value); options.onProgress?.(bytes);
		}
		assert.equal(bytes, options.bytes, "READBACK_TRUNCATED"); const sha256 = hash.digest("hex");
		assert.equal(sha256, options.sha256, "READBACK_HASH_MISMATCH");
		return { bytes, sha256, elapsedMs: Math.round(performance.now() - started) };
	} finally { clearTimeout(idle); clearTimeout(total); await reader?.cancel().catch(() => {}); controller.abort(); }
}
