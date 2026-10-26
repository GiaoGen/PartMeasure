// Single HTTP byte ranges; reject impossible ranges before requesting upstream bytes.
export function satisfiableRange(value: string, size: number) {
	if (value.length > 200 || !Number.isSafeInteger(size) || size <= 0) return false;
	const match = /^bytes=(\d*)-(\d*)$/.exec(value);
	if (!match || (!match[1] && !match[2])) return false;
	const start = match[1] ?? "", end = match[2] ?? "";
	if (!start) return BigInt(end) > 0n;
	return BigInt(start) < BigInt(size) && (!end || BigInt(end) >= BigInt(start));
}

export function byteRange(value: string, size: number) {
	if (!satisfiableRange(value, size)) return null;
	const [start = "", end = ""] = value.slice(6).split("-");
	const last = BigInt(size - 1);
	const min = (a: bigint, b: bigint) => a < b ? a : b;
	const from = start ? BigInt(start) : BigInt(size) - min(BigInt(end), BigInt(size));
	const to = start && end ? min(BigInt(end), last) : last;
	return { start: Number(from), end: Number(to), bytes: Number(to - from + 1n) };
}
