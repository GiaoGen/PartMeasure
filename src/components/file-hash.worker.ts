// A separate thread keeps large file hashing off the interaction/paint thread.
globalThis.addEventListener("message", async (event: MessageEvent<{ file: File }>) => {
	try {
		const bytes = await crypto.subtle.digest("SHA-256", await event.data.file.arrayBuffer());
		globalThis.postMessage({
			hash: Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join(""),
		});
	} catch {
		globalThis.postMessage({ error: "FILE_HASH_FAILED" });
	}
});
export {};
