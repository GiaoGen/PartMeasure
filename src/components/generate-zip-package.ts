import {
	zipLimits,
	zipDataText,
	zipFileKey,
	zipReadme,
	zipSelectionQuery,
	zipSelectionSchema,
	checkZipSnapshot,
	safeZipFilename,
	type ZipFile,
	type ZipSelection,
	type ZipSnapshot,
} from "@/lib/zip-package";
import { crc32, storedZip, type StoredZipEntry } from "@/lib/stored-zip";
import { AppError } from "@/lib/policy";
import { apiSessionGuard, ApiError, readApiTransport } from "./api";
import { runExport, breathe } from "./render-annotated-export";
import {
	downloadBudget,
	downloadTransfers,
	rangeBytes,
} from "./download-budget";
const chunkSize = 8 * 1024 * 1024;
export const sha256Bytes = async (bytes: Uint8Array<ArrayBuffer>) =>
	Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
export async function zipBinary(
	base: string,
	file: ZipFile,
	signal: AbortSignal,
	progress: (received: number) => void,
) {
	const bytes = new Uint8Array(file.byteSize);
	const url =
		file.variant === "delivery"
			? `${base}/deliveries/${file.deliveryId}/files/${file.id}/download`
			: `${base}/files/${file.id}/download${file.variant === "original" ? "?original=1" : ""}`;
	let crc = 0;
	for (let start = 0; start < file.byteSize; start += chunkSize) {
		signal.throwIfAborted();
		const end = Math.min(file.byteSize - 1, start + chunkSize - 1);
		const response = await fetch(url, {
			cache: "no-store",
			headers: { Range: `bytes=${start}-${end}` },
			signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
		});
		if (!response.ok) {
			let code = "DEPENDENCY_UNAVAILABLE";
			try {
				code = (await response.json()).error.code;
			} catch {}
			throw new ApiError(code, response.status);
		}
		if (
			response.status !== 206 ||
			response.headers.get("content-range") !==
				`bytes ${start}-${end}/${file.byteSize}`
		) {
			await response.body?.cancel();
			throw new AppError("ZIP_SOURCE_CHANGED", 409);
		}
		const part = await rangeBytes(
			response,
			end - start + 1,
			signal,
			(received) => progress(start + received),
		);
		bytes.set(part, start);
		for (let offset = 0; offset < part.length; offset += 1024 * 1024) {
			crc = crc32(part.subarray(offset, offset + 1024 * 1024), crc);
			await breathe(signal);
		}
	}
	const hash = await sha256Bytes(bytes);
	signal.throwIfAborted();
	if (hash !== file.sha256) throw new AppError("ZIP_SOURCE_CHANGED", 409);
	return {
		path: file.path,
		data: new Blob([bytes], { type: file.mime }),
		crc,
	} satisfies StoredZipEntry;
}
export function verifyZipAccess(expected: ZipFile[], actual: ZipFile[]) {
	if (
		actual.length !== expected.length ||
		!expected.every((file) =>
			actual.some(
				(item) =>
					zipFileKey(item) === zipFileKey(file) &&
					item.sha256 === file.sha256 &&
					item.byteSize === file.byteSize,
			),
		)
	)
		throw new AppError("ZIP_SOURCE_CHANGED", 409);
}
export async function generateZipPackage(
	base: string,
	input: ZipSelection,
	signal: AbortSignal,
	progress: (status: string) => void,
) {
	const parsed = zipSelectionSchema.safeParse(input);
	if (!parsed.success) throw new AppError("INVALID_INPUT", 422);
	return runExport(signal, async () => {
		const ensureSession = apiSessionGuard(),
			query = zipSelectionQuery(parsed.data);
		progress("固定所选资料、交付附件和结构化数据…");
		const snapshot = await readApiTransport<ZipSnapshot>(
			`${base}/zip-snapshot?${query}`,
			signal,
		);
		ensureSession();
		signal.throwIfAborted();
		const sizes = checkZipSnapshot(snapshot),
			entries: StoredZipEntry[] = [];
		progress("等待下载内存预留…");
		const memory = await downloadBudget.acquire(sizes.reserve, signal);
		let retained = false;
		try {
			await downloadTransfers.run(signal, async () => {
				for (const [index, file] of snapshot.files.entries()) {
					ensureSession();
					signal.throwIfAborted();
					entries.push(
						await zipBinary(base, file, signal, (received) =>
							progress(
								`下载 ${index + 1}/${snapshot.files.length} · ${file.filename} · ${Math.round((received / file.byteSize) * 100)}%`,
							),
						),
					);
				}
			});
			progress("核对清单与打包…");
			const manifestEntries: {
				path: string;
				byteSize: number;
				sha256: string;
				fileId?: string;
				variant?: string;
				deliveryId?: string | null;
				filename?: string;
				mime?: string;
			}[] = snapshot.files.map((file) => ({
				path: file.path,
				fileId: file.id,
				variant: file.variant,
				deliveryId: file.deliveryId,
				filename: file.filename,
				mime: file.mime,
				byteSize: file.byteSize,
				sha256: file.sha256,
			}));
			for (const [path, text] of [
				["data.json", zipDataText(snapshot)],
				["README.txt", zipReadme],
			] as const) {
				const bytes = new TextEncoder().encode(text),
					sha256 = await sha256Bytes(bytes);
				entries.push({
					path,
					data: new Blob([bytes], { type: "text/plain;charset=utf-8" }),
					crc: crc32(bytes),
				});
				manifestEntries.push({ path, byteSize: bytes.length, sha256 });
				await breathe(signal);
			}
			const manifest = {
				schemaVersion: 1,
				snapshotId: snapshot.snapshotId,
				capturedAt: snapshot.capturedAt,
				project: snapshot.project,
				selection: snapshot.selection,
				delivery: snapshot.data.delivery,
				compression: "STORE",
				files: manifestEntries,
			};
			const manifestBytes = new TextEncoder().encode(
				`${JSON.stringify(manifest, null, 2)}\n`,
			);
			entries.push({
				path: "manifest.json",
				data: new Blob([manifestBytes], { type: "application/json" }),
				crc: crc32(manifestBytes),
			});
			const blob = storedZip(entries, snapshot.capturedAt, signal);
			if (blob.size > zipLimits.bytes) throw new AppError("ZIP_LIMIT", 413);
			progress("再次检查全部文件权限…");
			const authorized = await readApiTransport<{ files: ZipFile[] }>(
				`${base}/zip-access?${query}`,
				signal,
			);
			verifyZipAccess(snapshot.files, authorized.files);
			ensureSession();
			signal.throwIfAborted();
			memory.shrink(blob.size);
			retained = true;
			return {
				blob,
				filename: `${safeZipFilename(snapshot.project.name)}-资料包-${snapshot.snapshotId.slice(0, 8)}.zip`,
				release: () => memory.release(),
			};
		} finally {
			entries.length = 0;
			if (!retained) memory.release();
		}
	});
}
