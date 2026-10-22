export function fileHash(file: File, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		signal?.throwIfAborted();
		const worker = new Worker(new URL("./file-hash.worker.ts", import.meta.url), {
			type: "module",
		});
		const finish = () => {
			signal?.removeEventListener("abort", cancel);
			clearTimeout(timer);
			worker.terminate();
		};
		const cancel = () => { finish(); reject(signal?.reason); };
		signal?.addEventListener("abort", cancel, { once: true });
		const timer = setTimeout(() => {
			finish();
			reject(Error("文件校验超时，请重试。"));
		}, 60000);
		worker.onmessage = (event: MessageEvent<{ hash?: string }>) => {
			finish();
			if (/^[0-9a-f]{64}$/.test(event.data.hash ?? "")) resolve(event.data.hash as string);
			else reject(Error("文件校验失败，请重试。"));
		};
		worker.onerror = () => {
			finish();
			reject(Error("文件校验失败，请重试。"));
		};
		worker.postMessage({ file });
	});
}
