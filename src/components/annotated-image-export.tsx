"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
	ApiError,
	apiSessionGuard,
	message,
	onApiSessionCleared,
	onProjectCacheInvalidated,
} from "./api";
import { AppError } from "@/lib/policy";

export function AnnotatedImageExport({
	base,
	fileId,
	onInvalid,
	onClose,
	fileIds,
	reportOnly = false,
	onBusyChange,
}: {
	base: string;
	fileId: string;
	onInvalid: () => void;
	onClose: () => void;
	fileIds?: string[];
	reportOnly?: boolean;
	onBusyChange?: (busy: boolean) => void;
}) {
	const formatId = useId();
	const [format, setFormat] = useState<"png" | "jpg" | "pdf">(
			reportOnly ? "pdf" : "png",
		),
		[busy, setBusy] = useState(false),
		[status, setStatus] = useState(""),
		[error, setError] = useState("");
	const run = useRef<AbortController | null>(null),
		alive = useRef(true);
	const urls = useRef(new Set<string>());
	useEffect(() => {
		alive.current = true;
		const clear = () => {
			run.current?.abort();
			for (const url of urls.current) URL.revokeObjectURL(url);
			urls.current.clear();
		};
		const offSession = onApiSessionCleared(clear);
		const offProject = onProjectCacheInvalidated((projectBase, updates) => {
			if (
				projectBase === base &&
				updates.some(
					(event) =>
						(base.startsWith("/api/guest/") &&
							event.kind === "access.changed") ||
						(event.kind === "file.changed" &&
							(fileIds ?? [fileId]).includes(event.fileId ?? "") &&
							event.state !== "ready"),
				)
			)
				clear();
		});
		return () => {
			alive.current = false;
			clear();
			offSession();
			offProject();
			onBusyChange?.(false);
		};
	}, [base, fileId, fileIds, onBusyChange]);
	async function generate() {
		if (run.current) return;
		const controller = new AbortController();
		run.current = controller;
		const ensureSession = apiSessionGuard();
		setBusy(true);
		onBusyChange?.(true);
		setError("");
		setStatus("准备导出…");
		const deadline = setTimeout(
			() => controller.abort(new DOMException("Timed out", "TimeoutError")),
			format === "pdf" ? 180000 : 120000,
		);
		try {
			const progress = (value: string) => {
				if (alive.current) setStatus(value);
			};
			const result =
				format === "pdf"
					? await (await import("./render-pdf-report")).generatePdfReport(
							base,
							fileIds ?? [fileId],
							controller.signal,
							progress,
						)
					: await (
							await import("./render-annotated-export")
						).generateAnnotatedExport(
							base,
							fileId,
							format,
							controller.signal,
							progress,
						);
			ensureSession();
			controller.signal.throwIfAborted();
			if (!alive.current) return;
			const url = URL.createObjectURL(result.blob),
				anchor = document.createElement("a");
			urls.current.add(url);
			try {
				anchor.href = url;
				anchor.download = result.filename;
				document.body.append(anchor);
				anchor.click();
				setStatus(
					format === "pdf"
						? "已交给浏览器保存PDF，请检查下载列表。"
						: "已交给浏览器保存，请检查下载列表；手机可能需要在下载项中另存图片。",
				);
			} finally {
				anchor.remove();
				setTimeout(() => {
					URL.revokeObjectURL(url);
					urls.current.delete(url);
				}, 15000);
			}
		} catch (failure) {
			if (!alive.current) return;
			if (failure instanceof ApiError && failure.status === 401) {
				onInvalid();
				return;
			}
			if (controller.signal.aborted)
				setStatus(
					controller.signal.reason?.name === "TimeoutError"
						? "导出超时，可重新生成。"
						: "导出已取消，可重新生成。",
				);
			else {
				setStatus("");
				setError(
					failure instanceof ApiError || failure instanceof AppError
						? message(failure.code)
						: failure instanceof Error && failure.message === "IMAGE_CACHE_BUSY"
							? "另一张图片正在导出，请稍后再试。"
							: "导出未能完成，请重试；若手机内存不足，请使用桌面浏览器。",
				);
			}
		} finally {
			clearTimeout(deadline);
			run.current = null;
			onBusyChange?.(false);
			if (alive.current) setBusy(false);
		}
	}
	return (
		<section
			className="annotated-image-export"
			aria-label={reportOnly ? "PDF资料报告导出" : "标注图片与PDF导出"}
		>
			<p>
				{reportOnly
					? `导出已选 ${fileIds?.length ?? 1} 张照片的当前已保存状态与处理记录。`
					: "导出当前已保存图片与标注，不含未保存改动。"}
			</p>
			<div className="annotated-image-export-actions">
				{!reportOnly ? <label htmlFor={formatId}>格式</label> : null}
				{!reportOnly ? (
					<select
						id={formatId}
						value={format}
						disabled={busy}
						onChange={(event) =>
							setFormat(event.target.value as "png" | "jpg" | "pdf")
						}
					>
						<option value="png">PNG</option>
						<option value="jpg">JPG</option>
						<option value="pdf">PDF资料报告</option>
					</select>
				) : null}
				<button type="button" disabled={busy} onClick={() => void generate()}>
					{busy
						? "生成中…"
						: error
							? "重新生成"
							: format === "pdf"
								? "生成PDF并下载"
								: "生成并下载"}
				</button>
				{busy ? (
					<button type="button" onClick={() => run.current?.abort()}>
						取消
					</button>
				) : null}
				<button type="button" onClick={onClose}>
					{busy ? "取消并收起" : "收起"}
				</button>
			</div>
			{status ? <p role="status">{status}</p> : null}
			{error ? (
				<p role="alert" className="error">
					{error}
				</p>
			) : null}
		</section>
	);
}
