"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
	type Delivery,
	type DeliveryHistoryPage,
	versionLabel,
} from "@/lib/deliveries";
import type { ZipSelection } from "@/lib/zip-package";
import { AppError } from "@/lib/policy";
import {
	api,
	ApiError,
	apiSessionGuard,
	message,
	onApiSessionCleared,
	onProjectCacheInvalidated,
} from "./api";

export function ZipPackageExport({
	base,
	guest,
	materialIds,
	onInvalid,
	onClose,
	onBusyChange,
	fixedDelivery,
	visible = true,
}: {
	base: string;
	guest: boolean;
	materialIds: string[];
	onInvalid: () => void;
	onClose: () => void;
	onBusyChange?: (busy: boolean) => void;
	fixedDelivery?: Delivery;
	visible?: boolean;
}) {
	const region = useId();
	const [originals, setOriginals] = useState(false),
		[latest, setLatest] = useState<Delivery | null>(null),
		[history, setHistory] = useState<DeliveryHistoryPage | null>(null),
		[trail, setTrail] = useState<(string | null)[]>([null]);
	const [delivery, setDelivery] = useState<Delivery | null>(
			fixedDelivery ?? null,
		),
		[attachmentIds, setAttachmentIds] = useState<string[]>(
			() => fixedDelivery?.files.map((file) => file.id) ?? [],
		);
	const [reading, setReading] = useState(false),
		[busy, setBusy] = useState(false),
		[status, setStatus] = useState(""),
		[error, setError] = useState("");
	const active = useRef(true),
		readRun = useRef(0),
		readAbort = useRef<AbortController | null>(null),
		running = useRef<AbortController | null>(null),
		urls = useRef(new Map<string, () => void>());
	const currentSelection = useRef({ materialIds, attachmentIds });
	currentSelection.current = { materialIds, attachmentIds };
	const invalid = useRef(onInvalid);
	invalid.current = onInvalid;
	const fixedId = fixedDelivery?.id;
	const latestRef = useRef<Delivery | null>(null);
	const fail = useCallback((error: unknown) => {
		if (error instanceof ApiError && error.status === 401) invalid.current();
		setError(
			error instanceof Error ? error.message : "读取交付版本失败，请重试。",
		);
	}, []);
	const readVersion = useCallback(
		async (id?: string, nextTrail?: (string | null)[]) => {
			const latest = latestRef.current;
			const generation = ++readRun.current;
			readAbort.current?.abort();
			const controller = new AbortController();
			readAbort.current = controller;
			setReading(true);
			setError("");
			try {
				if (nextTrail && latest) {
					const query = new URLSearchParams({
						view: "history",
						beforeVersion: String(latest.versionNo ?? 1),
					});
					const cursor = nextTrail.at(-1);
					if (cursor) query.set("cursor", cursor);
					const page = await api<DeliveryHistoryPage>(
						`${base}/deliveries?${query}`,
						"GET",
						undefined,
						{ signal: controller.signal },
					);
					if (generation === readRun.current) {
						setHistory(page);
						setTrail(nextTrail);
					}
				} else if (id) {
					const selected =
						latest?.id === id
							? latest
							: await api<Delivery>(
									`${base}/deliveries/${id}`,
									"GET",
									undefined,
									{ signal: controller.signal },
								);
					if (generation === readRun.current) {
						setDelivery(selected);
						setAttachmentIds(selected.files.map((file) => file.id));
					}
				} else {
					const data = await api<{ published: Delivery | null }>(
						`${base}/deliveries`,
						"GET",
						undefined,
						{ signal: controller.signal },
					);
					if (generation === readRun.current) {
						latestRef.current = data.published;
						setLatest(data.published);
					}
				}
			} catch (error) {
				if (generation === readRun.current && !controller.signal.aborted)
					fail(error);
			} finally {
				if (generation === readRun.current) setReading(false);
			}
		},
		[base, fail],
	);
	useEffect(() => {
		active.current = true;
		if (!fixedId) void readVersion();
		const clear = () => {
			running.current?.abort();
			for (const [url, release] of urls.current) {
				URL.revokeObjectURL(url);
				release();
			}
			urls.current.clear();
		};
		const offSession = onApiSessionCleared(clear);
		const offProject = onProjectCacheInvalidated((projectBase, events) => {
			if (
				projectBase === base &&
				events.some(
					(event) =>
						(guest && event.kind === "access.changed") ||
						(event.kind === "file.changed" &&
							event.state !== "ready" &&
							[
								...currentSelection.current.materialIds,
								...currentSelection.current.attachmentIds,
							].includes(event.fileId ?? "")),
				)
			)
				clear();
		});
		return () => {
			active.current = false;
			++readRun.current;
			readAbort.current?.abort();
			clear();
			onBusyChange?.(false);
			offSession();
			offProject();
		};
		// Only bootstrap on opening; later version reads are explicit user actions.
	}, [base, fixedId, guest, onBusyChange, readVersion]);
	useEffect(() => {
		if (!visible) running.current?.abort();
	}, [visible]);
	async function generate() {
		if (running.current || reading) return;
		const selection: ZipSelection = {
			materialIds: [...materialIds],
			originals: !guest && originals,
			delivery:
				delivery && attachmentIds.length
					? { id: delivery.id, fileIds: [...attachmentIds] }
					: null,
		};
		const controller = new AbortController(),
			ensureSession = apiSessionGuard();
		running.current = controller;
		setBusy(true);
		onBusyChange?.(true);
		setError("");
		setStatus("准备资料包…");
		const timer = setTimeout(
			() => controller.abort(new DOMException("Timed out", "TimeoutError")),
			300000,
		);
		let held: { release: () => void } | undefined;
		try {
			const { generateZipPackage } = await import("./generate-zip-package");
			const result = await generateZipPackage(
				base,
				selection,
				controller.signal,
				(value) => {
					if (active.current) setStatus(value);
				},
			);
			held = result;
			ensureSession();
			controller.signal.throwIfAborted();
			if (!active.current) return;
			const url = URL.createObjectURL(result.blob),
				anchor = document.createElement("a");
			urls.current.set(url, result.release);
			held = undefined;
			try {
				anchor.href = url;
				anchor.download = result.filename;
				document.body.append(anchor);
				anchor.click();
				setStatus(
					"已交给浏览器保存ZIP，请检查下载列表。包内清单可核对文件与来源。",
				);
			} finally {
				anchor.remove();
				setTimeout(() => {
					URL.revokeObjectURL(url);
					urls.current.delete(url);
					result.release();
				}, 15000);
			}
		} catch (error) {
			if (!active.current) return;
			if (error instanceof ApiError && error.status === 401) {
				invalid.current();
				return;
			}
			if (controller.signal.aborted)
				setStatus(
					controller.signal.reason?.name === "TimeoutError"
						? "资料包生成超时，请减少选择后重新生成。"
						: "已取消，本次未交付资料包，可重新生成。",
				);
			else {
				setStatus("");
				setError(
					error instanceof ApiError || error instanceof AppError
						? message(error.code)
						: error instanceof Error && error.message === "IMAGE_CACHE_BUSY"
							? "另一项导出正在进行，请稍后重试。"
							: "资料包未能完成，请重新生成；手机内存不足时可减少选择或使用桌面浏览器。",
				);
			}
		} finally {
			held?.release();
			clearTimeout(timer);
			running.current = null;
			if (active.current) {
				setBusy(false);
				onBusyChange?.(false);
			}
		}
	}
	const options = [latest, ...(history?.items ?? []), delivery].filter(
		(item, index, values) =>
			item && values.findIndex((other) => other?.id === item.id) === index,
	);
	return (
		<section
			className="zip-package-export"
			aria-label="ZIP资料包"
			aria-busy={busy}
		>
			<p>
				ZIP：已选 {materialIds.length}{" "}
				项资料；标准图片／原格式文件及结构化数据。单包最多128MiB。
			</p>
			{!guest && !fixedDelivery ? (
				<label className="zip-option">
					<input
						type="checkbox"
						checked={originals}
						disabled={busy}
						onChange={(event) => setOriginals(event.target.checked)}
					/>
					额外附带原始照片（可能含原始EXIF）
				</label>
			) : null}
			{!fixedDelivery ? (
				<div className="zip-package-actions">
					<label htmlFor={region}>附带交付附件（可选）</label>
					<select
						id={region}
						disabled={busy || reading}
						value={delivery?.id ?? ""}
						onChange={(event) => {
							const id = event.target.value;
							if (!id) {
								setDelivery(null);
								setAttachmentIds([]);
							} else void readVersion(id);
						}}
					>
						<option value="">不附带交付附件</option>
						{options.map((item) =>
							item ? (
								<option key={item.id} value={item.id}>
									{versionLabel(item.versionNo ?? 1)}
								</option>
							) : null,
						)}
					</select>
					{latest && (latest.versionNo ?? 1) > 1 ? (
						<>
							<button
								type="button"
								disabled={
									busy || reading || (history !== null && !history.nextCursor)
								}
								onClick={() => {
									if (!history) void readVersion(undefined, [null]);
									else if (history.nextCursor)
										void readVersion(undefined, [...trail, history.nextCursor]);
								}}
							>
								{history ? "更早版本" : "查看历史版本"}
							</button>
							{trail.length > 1 ? (
								<button
									type="button"
									disabled={busy || reading}
									onClick={() =>
										void readVersion(undefined, trail.slice(0, -1))
									}
								>
									较新版本
								</button>
							) : null}
						</>
					) : null}
				</div>
			) : null}
			{reading ? <p role="status">读取已发布版本…</p> : null}
			{delivery ? (
				<fieldset disabled={busy || reading}>
					<legend>
						{versionLabel(delivery.versionNo ?? 1)} 附件（已选
						{attachmentIds.length}）
					</legend>
					{delivery.files.map((file) => (
						<label key={file.id} className="zip-option">
							<input
								type="checkbox"
								checked={attachmentIds.includes(file.id)}
								onChange={(event) =>
									setAttachmentIds((ids) =>
										event.target.checked
											? [...ids, file.id]
											: ids.filter((id) => id !== file.id),
									)
								}
							/>
							{file.filename} ·{" "}
							{(Number(file.byteSize) / 1024 / 1024).toFixed(2)} MiB
						</label>
					))}
				</fieldset>
			) : null}
			<div className="zip-package-actions">
				<button
					type="button"
					disabled={
						busy || reading || (!materialIds.length && !attachmentIds.length)
					}
					onClick={() => void generate()}
				>
					{busy ? "打包中…" : "生成ZIP并下载"}
				</button>
				{busy ? (
					<button type="button" onClick={() => running.current?.abort()}>
						取消生成
					</button>
				) : null}
				<button type="button" onClick={onClose}>
					{busy ? "取消并收起" : "取消选择／收起"}
				</button>
				{error && !fixedDelivery ? (
					<button
						type="button"
						disabled={busy || reading}
						onClick={() => void readVersion()}
					>
						重试读取交付版本
					</button>
				) : null}
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
