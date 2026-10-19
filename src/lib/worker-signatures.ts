/** CVD/CLD signed database header format: field 8 is its build Unix timestamp. */
export function signatureHeader(header: string, now = Date.now()) {
	const fields = header.trim().split(":"),
		version = Number(fields[2]),
		built = Number(fields[8]) * 1000;
	if (
		fields[0] !== "ClamAV-VDB" ||
		!Number.isSafeInteger(version) ||
		version < 1 ||
		!Number.isSafeInteger(built) ||
		built > now + 300000 ||
		now - built > 72 * 3600000
	)
		throw Error("SCANNER_SIGNATURES_STALE");
	return { version, built };
}
export function loadedSignatureVersion(reply: string, expected: number) {
	const version = Number(reply.match(/^ClamAV [^/]+\/(\d+)\//)?.[1]);
	if (!Number.isSafeInteger(version) || version < expected)
		throw Error("SCANNER_RELOAD_REQUIRED");
}
