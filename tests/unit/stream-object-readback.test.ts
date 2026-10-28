import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { streamObjectReadback } from "../../scripts/maintenance/stream-object-readback";
const config = { endpoint: "https://abcdefghijklmnopqrst.supabase.co", apiKey: "synthetic-only", bucket: "partmeasure-private", key: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/source", bytes: 3, sha256: createHash("sha256").update("abc").digest("hex"), signal: AbortSignal.timeout(5000) };
const respond = (response: Response) => (async () => response) as typeof fetch;
it("authenticates all bytes without Blob buffering", async () => {
	const parts: number[] = []; const result = await streamObjectReadback({ ...config, fetcher: respond(new Response("abc")), onProgress: n => parts.push(n) });
	expect(result.bytes).toBe(3); expect(result.sha256).toBe(config.sha256); expect(parts.at(-1)).toBe(3);
});
it("rejects dependency 503 and unauthorized 401 as failed readback", async () => {
	for (const status of [401, 503]) await expect(streamObjectReadback({ ...config, fetcher: respond(new Response("", { status })) })).rejects.toThrow(`READBACK_HTTP_${status}`);
});
it("rejects corruption, truncation and extra data", async () => {
	for (const [text, reason] of [["abd", "READBACK_HASH_MISMATCH"], ["ab", "READBACK_TRUNCATED"], ["abcd", "READBACK_SIZE_LIMIT"]])
		await expect(streamObjectReadback({ ...config, fetcher: respond(new Response(text)) })).rejects.toThrow(reason);
});
