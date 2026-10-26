import "server-only";

/** Bound each provider request, retaining caller cancellation. No local authentication fallback. */
export const authFetch: typeof fetch = (input, init) => fetch(input, {
	...init,
	signal: AbortSignal.any([
		...(init?.signal ? [init.signal] : []),
		...(input instanceof Request ? [input.signal] : []),
		AbortSignal.timeout(15000),
	]),
});
