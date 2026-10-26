import "server-only";

/** Abort even when an upstream reader does not implement cancellation promptly. */
export function readWithSignal<T>(reader: ReadableStreamDefaultReader<T>, signal: AbortSignal): Promise<ReadableStreamReadResult<T>> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const abort = () => {
			void reader.cancel().catch(() => {});
			reject(signal.reason);
		};
		signal.addEventListener("abort", abort, { once: true });
		reader.read().then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}
