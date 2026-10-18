"use client";
import { useEffect, useRef, useState } from "react";
import type { DeliveryFile } from "@/lib/deliveries";
import { ApiError, message } from "./api";
const chunkBytes = 4 * 1024 * 1024;
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
		objectUrls = useRef(new Set<string>());
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			controller.current?.abort();
			parts.current = [];
			for (const url of objectUrls.current) URL.revokeObjectURL(url);
		};
	}, []);
	async function download() {
		if (running.current) return;
		running.current = true;
		setBusy(true);
		setError("");
		setStatus("正在下载…");
		const total = Number(file.byteSize),
			abort = new AbortController();
		controller.current = abort;
		try {
			if (
				!Number.isSafeInteger(total) ||
				total < 1 ||
				total > 100 * 1024 * 1024
			)
				throw new Error("SIZE");
			while (offset.current < total) {
				const start = offset.current,
					end = Math.min(total - 1, start + chunkBytes - 1);
				const response = await fetch(
					`${base}/deliveries/${deliveryId}/files/${file.id}/download`,
					{
						cache: "no-store",
						headers: { Range: `bytes=${start}-${end}` },
						signal: abort.signal,
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
				)
					throw new Error("RANGE");
				const bytes = new Uint8Array(await response.arrayBuffer());
				if (bytes.byteLength !== end - start + 1) throw new Error("INCOMPLETE");
				if (!alive.current) return;
				parts.current.push(bytes);
				offset.current = end + 1;
				setProgress(Math.round((offset.current / total) * 100));
			}
			const blob = new Blob(parts.current, { type: file.mime }),
				url = URL.createObjectURL(blob),
				anchor = document.createElement("a");
			objectUrls.current.add(url);
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
			}, 60000);
		} catch (e) {
			if (!alive.current) return;
			if (abort.signal.aborted) {
				setStatus("下载已取消，可重新开始。");
				parts.current = [];
				offset.current = 0;
				setProgress(0);
			} else {
				if (
					e instanceof ApiError &&
					(e.status === 401 || e.status === 403 || e.status === 404)
				) {
					parts.current = [];
					offset.current = 0;
					if (e.status === 401) onInvalid();
				}
				setError(
					e instanceof ApiError
						? message(e.code)
						: "下载未完成，请重试；已完整收到的片段会继续使用。",
				);
				setStatus("下载未完成");
			}
		} finally {
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
