import { AppError } from "./policy";
import { zipLimits } from "./zip-package";
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
	let value = n;
	for (let bit = 0; bit < 8; bit++)
		value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	return value >>> 0;
});
export function crc32(bytes: Uint8Array, previous = 0) {
	let value = (previous ^ 0xffffffff) >>> 0;
	for (const byte of bytes)
		value = (crcTable[(value ^ byte) & 255] ?? 0) ^ (value >>> 8);
	return (value ^ 0xffffffff) >>> 0;
}
export type StoredZipEntry = { path: string; data: Blob; crc: number };
/** ZIP32 STORE, UTF-8 names, known sizes/CRC, regular DOS files only. */
export function storedZip(
	entries: StoredZipEntry[],
	capturedAt: string,
	signal: AbortSignal,
): Blob {
	signal.throwIfAborted();
	if (!entries.length || entries.length > zipLimits.entries)
		throw new AppError("ZIP_LIMIT", 413);
	const paths = new Set<string>(),
		local: BlobPart[] = [],
		central: BlobPart[] = [],
		encoder = new TextEncoder();
	// DOS timestamps carry no timezone; use the product's UTC+8 local time.
	const time = new Date(Date.parse(capturedAt) + 8 * 60 * 60 * 1000);
	if (!Number.isFinite(time.getTime()))
		throw new AppError("INVALID_INPUT", 422);
	const year = Math.max(1980, Math.min(2107, time.getUTCFullYear())),
		dosTime =
			(time.getUTCHours() << 11) |
			(time.getUTCMinutes() << 5) |
			(time.getUTCSeconds() >> 1),
		dosDate =
			((year - 1980) << 9) |
			((time.getUTCMonth() + 1) << 5) |
			time.getUTCDate();
	let offset = 0,
		centralSize = 0;
	for (const entry of entries) {
		signal.throwIfAborted();
		const name = encoder.encode(entry.path);
		if (
			!entry.path ||
			entry.path.startsWith("/") ||
			/[\\:\p{Cc}\p{Cf}]/u.test(entry.path) ||
			entry.path
				.split("/")
				.some((part) => !part || part === "." || part === "..") ||
			name.length > 512 ||
			paths.has(entry.path) ||
			entry.data.size > zipLimits.bytes ||
			!Number.isInteger(entry.crc) ||
			entry.crc < 0 ||
			entry.crc > 0xffffffff
		)
			throw new AppError("ZIP_LIMIT", 413);
		paths.add(entry.path);
		const header = new Uint8Array(30),
			h = new DataView(header.buffer);
		h.setUint32(0, 0x04034b50, true);
		h.setUint16(4, 20, true);
		h.setUint16(6, 0x800, true);
		h.setUint16(10, dosTime, true);
		h.setUint16(12, dosDate, true);
		h.setUint32(14, entry.crc, true);
		h.setUint32(18, entry.data.size, true);
		h.setUint32(22, entry.data.size, true);
		h.setUint16(26, name.length, true);
		const directory = new Uint8Array(46),
			d = new DataView(directory.buffer);
		d.setUint32(0, 0x02014b50, true);
		d.setUint16(4, 20, true);
		d.setUint16(6, 20, true);
		d.setUint16(8, 0x800, true);
		d.setUint16(12, dosTime, true);
		d.setUint16(14, dosDate, true);
		d.setUint32(16, entry.crc, true);
		d.setUint32(20, entry.data.size, true);
		d.setUint32(24, entry.data.size, true);
		d.setUint16(28, name.length, true);
		d.setUint32(42, offset, true);
		local.push(header, name, entry.data);
		central.push(directory, name);
		offset += 30 + name.length + entry.data.size;
		centralSize += 46 + name.length;
		if (offset + centralSize + 22 > zipLimits.bytes)
			throw new AppError("ZIP_LIMIT", 413);
	}
	const end = new Uint8Array(22),
		e = new DataView(end.buffer);
	e.setUint32(0, 0x06054b50, true);
	e.setUint16(8, entries.length, true);
	e.setUint16(10, entries.length, true);
	e.setUint32(12, centralSize, true);
	e.setUint32(16, offset, true);
	return new Blob([...local, ...central, end], { type: "application/zip" });
}
