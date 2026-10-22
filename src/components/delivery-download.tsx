"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DeliveryFile } from "@/lib/deliveries";
import { ApiError, message, onApiSessionCleared, apiSessionGuard } from "./api";
import { downloadBudget, downloadTransfers, rangeBytes } from "./download-budget";
const chunkBytes = 8 * 1024 * 1024;
export function DeliveryDownload({
	base,
	deliveryId,
	file,
	onInvalid,
}: {
	base: string;
	deliveryId: string;
	file: DeliveryFile;
	onInvalid: () => void;
}) {
	const [busy, setBusy] = useState(false),
		[progress, setProgress] = useState(0),
		[error, setError] = useState(""),
		[status, setStatus] = useState("");
	const running = useRef(false),
		parts = useRef<Uint8Array<ArrayBuffer>[]>([]),
		offset = useRef(0),
		controller = useRef<AbortController | null>(null),
		alive = useRef(true),
		objectUrls = useRef(new Map<string, () => void>());
	const memory = useRef<Awaited<ReturnType<typeof downloadBudget.acquire>> | null>(null);
	const partialExpiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const releasePartial = useCallback(() => { clearTimeout(partialExpiry.current); parts.current = []; offset.current = 0; memory.current?.release(); memory.current = null; }, []);
	useEffect(() => {
		alive.current = true;
		const off = onApiSessionCleared(() => { controller.current?.abort(); releasePartial(); for (const [url, release] of objectUrls.current) { URL.revokeObjectURL(url); release(); } objectUrls.current.clear(); });
		return () => {
			alive.current = false;
			off(); releasePartial();
			controller.current?.abort();
			parts.current = [];
			for (const [url, release] of objectUrls.current) { URL.revokeObjectURL(url); release(); }
		};
	}, [releasePartial]);
	async function download() {
		if (running.current) return;
		running.current = true;
		setBusy(true);
		setError("");
		setStatus("准备下载…");
		clearTimeout(partialExpiry.current);
		const ensureSession = apiSessionGuard();
		const total = Number(file.byteSize),
			abort = new AbortController();
		controller.current = abort;
		const deadline = setTimeout(() => abort.abort(new DOMException("Timed out", "TimeoutError")), 300000);
		try {
			await downloadTransfers.run(abort.signal, async () => {
			ensureSession();
			if (
				!Number.isSafeInteger(total) ||
				total < 1 ||
				total > 100 * 1024 * 1024
			)
				throw new Error("SIZE");
			memory.current ??= await downloadBudget.acquire(total * 2, abort.signal);
			ensureSession(); abort.signal.throwIfAborted();
			setStatus("正在下载…");
			while (offset.current < total) {
				const start = offset.current,
					end = Math.min(total - 1, start + chunkBytes - 1);
				const response = await fetch(
					`${base}/deliveries/${deliveryId}/files/${file.id}/download`,
					{
						cache: "no-store",
						headers: { Range: `bytes=${start}-${end}` },
						signal: AbortSignal.any([abort.signal, AbortSignal.timeout(90000)]),
					},
				);
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
						`bytes ${start}-${end}/${total}`
				) { await response.body?.cancel(); throw new Error("RANGE"); }
				const bytes = await rangeBytes(response, end - start + 1, abort.signal, received => { if (alive.current) setProgress(Math.round(((start + received) / total) * 100)); });
				ensureSession();
				if (bytes.byteLength !== end - start + 1) throw new Error("INCOMPLETE");
				if (!alive.current) return;
				parts.current.push(bytes);
				offset.current = end + 1;
				setProgress(Math.round((offset.current / total) * 100));
			}
			ensureSession(); abort.signal.throwIfAborted();
			const blob = new Blob(parts.current, { type: file.mime }),
				url = URL.createObjectURL(blob),
				anchor = document.createElement("a");
			const retained = memory.current; memory.current = null; retained?.shrink(total);
			objectUrls.current.set(url, () => retained?.release());
			anchor.href = url;
			anchor.download =
				file.mime === "image/webp"
					? file.filename.replace(/\.[^.]+$/, ".webp")
					: file.filename;
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			parts.current = [];
			offset.current = 0;
			setStatus("已交给浏览器保存，请检查下载列表。");
			setTimeout(() => {
				URL.revokeObjectURL(url);
				objectUrls.current.delete(url);
				retained?.release();
			}, 15000);
			});
		} catch (e) {
			if (!alive.current) return;
			partialExpiry.current = setTimeout(releasePartial, 30000);
			if (abort.signal.aborted) {
				setStatus(abort.signal.reason?.name === "TimeoutError" ? "下载超时，可重新开始。" : "下载已取消，可重新开始。");
				releasePartial();
				setProgress(0);
			} else {
				if (
					e instanceof ApiError &&
					(e.status === 401 || e.status === 403 || e.status === 404)
				) {
					releasePartial();
					if (e.status === 401) onInvalid();
				}
				setError(
					e instanceof ApiError
						? message(e.code)
						: "下载未完成，请重试。",
				);
				setStatus("下载未完成");
			}
		} finally {
			clearTimeout(deadline);
			running.current = false;
			if (alive.current) setBusy(false);
		}
	}
	return (
		<div className="delivery-download">
			<button
				type="button"
				aria-label={`${error ? "重试下载" : "下载"} ${file.filename}`}
				disabled={busy}
				onClick={() => void download()}
			>
				{busy ? `下载中 ${progress}%` : error ? "重试下载" : "下载"}
			</button>
			{busy ? (
				<>
					<progress
						aria-label={`${file.filename} 下载进度`}
						max={100}
						value={progress}
					/>
					<button type="button" onClick={() => controller.current?.abort()}>
						取消下载
					</button>
				</>
			) : null}
			{status ? <small role="status">{status}</small> : null}
			{error ? (
				<p role="alert" className="error">
					{error}
				</p>
			) : null}
		</div>
	);
}
