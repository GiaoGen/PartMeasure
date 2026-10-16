// Single HTTP byte ranges; reject impossible ranges before requesting upstream bytes.
export function satisfiableRange(value: string, size: number) {
	if (value.length > 200 || !Number.isSafeInteger(size) || size <= 0) return false;
	const match = /^bytes=(\d*)-(\d*)$/.exec(value);
	if (!match || (!match[1] && !match[2])) return false;
	const start = match[1] ?? "", end = match[2] ?? "";
	if (!start) return BigInt(end) > 0n;
	return BigInt(start) < BigInt(size) && (!end || BigInt(end) >= BigInt(start));
}
