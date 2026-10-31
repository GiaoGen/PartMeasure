"use client";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { api, message, onApiSessionCleared, apiSessionGuard } from "./api";
import { useProjectUpdates } from "./project-live";
import { uploadPipeline, uploadPause } from "./upload-pipeline";
import { fileHash } from "./file-hash";
import { WorkspaceIcon, useWorkspaceDisclosure } from "./workspace-ui";
import { useProjectReadOnly } from "./project-read-only";
export type ReadyUpload = {
	id: string;
	filename: string;
	mime: string;
	byteSize: string;
};
type Item = {
	id: string;
	file: File;
	key: string;
	completeKey: string;
	progress: number;
	state:
		| "waiting"
		| "checking"
		| "reserving"
		| "uploading"
		| "processing_wait"
		| "processing"
		| "ready"
		| "failed";
	error: string;
	reservationId?: string;
	terminal?: boolean;
	uploaded?: boolean;
};
type Grant = {
	signedUrl: string;
	token: string;
	path: string;
	supabaseUrl: string;
	state?: string;
};
type Tracked = {
	id: string;
	filename: string;
	state: string;
	errorCode: string | null;
	processingActive?: boolean;
	canProcess?: boolean;
};
export function UploadQueue({
	base,
	onReady,
	onInvalid,
	purpose = "material",
	floating = false,
	compact = false,
	emptyHint,
	localOnly = false,
	pickerRef,
	buttonLabel,
	onBusyChange,
	onPendingChange,
	entryTarget,
}: {
	base: string;
	onReady: (file?: ReadyUpload) => void;
	onInvalid: () => void;
	purpose?: "material" | "delivery";
	floating?: boolean;
	compact?: boolean;
	emptyHint?: string | undefined;
	localOnly?: boolean;
	pickerRef?: RefObject<HTMLInputElement | null>;
	buttonLabel?: string;
	onBusyChange?: (busy: boolean) => void;
	onPendingChange?: (pending: boolean) => void;
	entryTarget?: HTMLElement | null;
}) {
	const archived = useProjectReadOnly();
	const picker = useRef<HTMLInputElement>(null),
		camera = useRef<HTMLInputElement>(null),
		album = useRef<HTMLInputElement>(null);
	const dock = useRef<HTMLDivElement>(null);
	const chooser = useWorkspaceDisclosure();
	useEffect(() => {
		if (!chooser.mounted) return;
		function outside(event: PointerEvent) {
			if (event.target instanceof Node && !dock.current?.contains(event.target))
				chooser.hide();
		}
		function dismissOnEscape(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			chooser.hide();
			dock.current
				?.querySelector<HTMLButtonElement>(".workspace-upload-trigger")
				?.focus();
		}
		document.addEventListener("pointerdown", outside);
		document.addEventListener("keydown", dismissOnEscape);
		return () => {
			document.removeEventListener("pointerdown", outside);
			document.removeEventListener("keydown", dismissOnEscape);
		};
	}, [chooser.mounted, chooser.hide]);
	const [items, setItems] = useState<Item[]>([]),
		[error, setError] = useState("");
	const running = useRef(new Set<string>());
	const notified = useRef(new Set<string>());
	const lifetime = useRef(new AbortController());
	useEffect(() => {
		if (archived) {
			lifetime.current.abort();
			setItems((old) =>
				old.map((item) =>
					item.state === "ready"
						? item
						: {
								...item,
								state: "failed",
								error: "项目已归档；恢复后可重试或重新选择文件。",
							},
				),
			);
			return;
		}
		if (lifetime.current.signal.aborted)
			lifetime.current = new AbortController();
		const off = onApiSessionCleared(() => lifetime.current.abort());
		return () => {
			off();
			lifetime.current.abort();
		};
	}, [archived]);
	const finishUpload = async (id: string, key: string, onStart: () => void) => {
		const signal = lifetime.current.signal;
		return uploadPipeline.finish(signal, async () => {
			for (let attempt = 0; ; attempt++) {
				signal.throwIfAborted();
				onStart();
				try {
					const result = await api(
						`${base}/uploads/${id}/complete`,
						"POST",
						{},
						{ key },
					);
					signal.throwIfAborted();
					return result;
				} catch (failure) {
					if (
						attempt >= 2 ||
						!["PROCESSING_BUSY", "PROCESSING_ACTIVE"].includes(
							(failure as { code?: string }).code ?? "",
						)
					)
						throw failure;
					await uploadPause(1500 * (attempt + 1), signal);
				}
			}
		});
	};

	const [tracked, setTracked] = useState<Tracked[]>([]);
	const busyRef = useRef(onBusyChange);
	busyRef.current = onBusyChange;
	const pendingRef = useRef(onPendingChange);
	pendingRef.current = onPendingChange;
	const working =
		items.some((item) => item.state !== "ready" && item.state !== "failed") ||
		tracked.some((item) => item.processingActive);
	useEffect(() => {
		busyRef.current?.(working);
	}, [working]);
	useEffect(() => () => busyRef.current?.(false), []);
	const unfinished = working || items.some((item) => item.state !== "ready");
	useEffect(() => {
		pendingRef.current?.(unfinished);
	}, [unfinished]);
	useEffect(() => () => pendingRef.current?.(false), []);
	const [maxFileBytes, setMaxFileBytes] = useState(50 * 1024 * 1024);
	useEffect(() => {
		void api<{ maxFileBytes: number }>("/api/upload-policy")
			.then((p) => setMaxFileBytes(p.maxFileBytes))
			.catch(() => setError("无法读取上传限制，请稍后重试。"));
	}, []);
	const itemsRef = useRef(items);
	itemsRef.current = items;
	const readyRef = useRef(onReady),
		invalidRef = useRef(onInvalid);
	readyRef.current = onReady;
	invalidRef.current = onInvalid;
	const recoverRef = useRef<() => void>(() => {});
	useEffect(() => {
		if (localOnly) return;
		let active = true,
			busy = false;
		async function recover() {
			if (busy) return;
			busy = true;
			try {
				const result = await api<{ items: Tracked[] }>(
					`${base}/uploads${purpose === "delivery" ? "?purpose=delivery" : ""}`,
				);
				if (active) {
					setTracked(result.items);
				}
			} catch (e) {
				if (!active) return;
				if ((e as { status?: number }).status === 401) invalidRef.current();
			} finally {
				busy = false;
			}
		}
		recoverRef.current = () => {
			void recover();
		};
		const timer = setTimeout(() => void recover(), 500);
		return () => {
			clearTimeout(timer);
			active = false;
			recoverRef.current = () => {};
		};
	}, [base, purpose, localOnly]);
	function notifyReady(item: Item, id = item.reservationId) {
		if (lifetime.current.signal.aborted) return;
		if (id && !notified.current.has(id)) {
			notified.current.add(id);
			if (notified.current.size > 128) {
				const oldest = notified.current.values().next().value;
				if (oldest) notified.current.delete(oldest);
			}
			readyRef.current({
				id,
				filename: item.file.name,
				mime: item.file.type,
				byteSize: String(item.file.size),
			});
		}
	}
	const update = useCallback(
		(id: string, changes: Partial<Item>) =>
			setItems((old) =>
				old.map((item) =>
					item.id === id
						? {
								...item,
								...changes,
								...(item.state === "ready" && changes.state === "processing"
									? { state: "ready" as const }
									: {}),
							}
						: item,
				),
			),
		[],
	);
	useProjectUpdates((updates) => {
		for (const e of updates) {
			if (e.kind === "resync") {
				readyRef.current();
				recoverRef.current();
				for (const item of itemsRef.current.filter(
					(i) => i.state === "processing" && i.reservationId,
				)) {
					const signal = lifetime.current.signal;
					void api<{ state: string; errorCode: string | null }>(
						`${base}/uploads/${item.reservationId}`,
					)
						.then((r) => {
							if (signal.aborted) return;
							if (r.state === "ready") {
								update(item.id, { state: "ready", error: "" });
								notifyReady(item);
							} else if (["rejected", "cleaned"].includes(r.state))
								update(item.id, {
									state: "failed",
									terminal: true,
									error: message(r.errorCode ?? "FILE_REJECTED"),
								});
						})
						.catch((e) => {
							if (e.status === 401) invalidRef.current();
						});
				}
			}
			if (e.kind !== "upload.changed") continue;
			const item = itemsRef.current.find((i) => i.reservationId === e.entityId);
			if (e.state === "ready" && !item) readyRef.current();
			if (item && e.state === "ready") {
				update(item.id, { state: "ready", error: "" });
				notifyReady(item);
			} else if (item && ["rejected", "cleaned"].includes(e.state ?? ""))
				update(item.id, {
					state: "failed",
					terminal: true,
					error: "文件处理未完成，请重试或联系工程师。",
				});
			if (e.state === "ready" || e.state === "cleaned")
				setTracked((old) => old.filter((x) => x.id !== e.entityId));
			else if (e.state) {
				const state = e.state;
				setTracked((old) =>
					old.map((x) => (x.id === e.entityId ? { ...x, state } : x)),
				);
			}
		}
	});

	async function send(item: Item) {
		if (archived) return;
		if (item.terminal) {
			item = {
				...item,
				key: crypto.randomUUID(),
				completeKey: crypto.randomUUID(),
				terminal: false,
				progress: 0,
				uploaded: false,
			};
			update(item.id, item);
		}
		if (item.file.size > maxFileBytes) {
			update(item.id, {
				state: "failed",
				error: `当前测试存储单文件最多 ${(maxFileBytes / 1024 / 1024).toFixed(0)} MiB。`,
			});
			return;
		}
		if (running.current.has(item.id)) return;
		running.current.add(item.id);
		update(item.id, { state: "waiting", error: "" });
		const signal = lifetime.current.signal;
		const ensureSession = apiSessionGuard();
		try {
			await uploadPipeline.run(base, signal, async () => {
				ensureSession();
				signal.throwIfAborted();
				if (item.reservationId && item.uploaded && !item.terminal) {
					update(item.id, { state: "processing_wait", error: "" });
					await finishUpload(item.reservationId, item.completeKey, () =>
						update(item.id, { state: "processing" }),
					);
					ensureSession();
					signal.throwIfAborted();
					update(item.id, { state: "ready", error: "" });
					notifyReady(item);
					return;
				}
				update(item.id, { state: "checking" });
				const hash = await fileHash(item.file, signal);
				ensureSession();
				signal.throwIfAborted();
				update(item.id, { state: "reserving" });
				const reservation = await uploadPipeline.reservation(base, signal, () =>
					api<{ id: string }>(
						`${base}/uploads`,
						"POST",
						{
							filename: item.file.name,
							byteSize: item.file.size,
							declaredMime: item.file.type,
							sha256: hash,
							...(purpose === "delivery" ? { purpose } : {}),
						},
						{ key: item.key },
					),
				);
				ensureSession();
				signal.throwIfAborted();
				update(item.id, { reservationId: reservation.id });
				const grant = await api<Grant>(
					`${base}/uploads/${reservation.id}/grant`,
					"POST",
				);
				ensureSession();
				signal.throwIfAborted();
				update(item.id, { state: "uploading" });
				if (!grant.state) {
					if (item.file.size > 6 * 1024 * 1024) {
						const { Upload } = await import("tus-js-client");
						await new Promise<void>((resolve, reject) => {
							const uploader = new Upload(item.file, {
								// Signed capabilities use the signed TUS route; the base route expects an Auth JWT.
								endpoint: `${grant.supabaseUrl.replace(".supabase.co", ".storage.supabase.co")}/storage/v1/upload/resumable/sign`,
								headers: { "x-signature": grant.token, "x-upsert": "false" },
								chunkSize: 6 * 1024 * 1024,
								retryDelays: [0, 1000, 3000, 5000],
								uploadDataDuringCreation: true,
								removeFingerprintOnSuccess: true,
								storeFingerprintForResuming: false,
								metadata: {
									bucketName: "partmeasure-quarantine",
									objectName: grant.path,
									contentType: item.file.type || "application/octet-stream",
									cacheControl: "0",
								},
								onProgress: (sent, total) =>
									update(item.id, {
										progress: Math.round((sent / total) * 100),
									}),
								onError: () => {
									signal.removeEventListener("abort", cancel);
									reject(new Error("文件传输失败，请重试。"));
								},
								onSuccess: () => {
									signal.removeEventListener("abort", cancel);
									resolve();
								},
							});
							const cancel = () => {
								void uploader.abort();
								reject(signal.reason);
							};
							signal.addEventListener("abort", cancel, { once: true });
							if (signal.aborted) {
								cancel();
								return;
							}
							uploader.start();
						});
					} else
						await new Promise<void>((resolve, reject) => {
							const xhr = new XMLHttpRequest();
							xhr.open("PUT", grant.signedUrl);
							xhr.setRequestHeader(
								"Content-Type",
								item.file.type || "application/octet-stream",
							);
							xhr.upload.onprogress = (e) => {
								if (e.lengthComputable)
									update(item.id, {
										progress: Math.round((e.loaded / e.total) * 100),
									});
							};
							const cancel = () => {
								xhr.abort();
								reject(signal.reason);
							};
							const cleanup = () => signal.removeEventListener("abort", cancel);
							xhr.onerror = () => {
								cleanup();
								reject(new Error("网络中断，请重试。"));
							};
							xhr.timeout = 120000;
							xhr.ontimeout = () => {
								cleanup();
								reject(new Error("上传超时，请重试。"));
							};
							xhr.onload = () => {
								cleanup();
								if (xhr.status >= 200 && xhr.status < 300) resolve();
								else if (xhr.status === 409) resolve();
								else reject(new Error("传输失败，请检查网络后重试。"));
							};
							signal.addEventListener("abort", cancel, { once: true });
							if (signal.aborted) {
								cancel();
								return;
							}
							xhr.send(item.file);
						});
				}
				ensureSession();
				signal.throwIfAborted();
				update(item.id, {
					state: "processing_wait",
					progress: 100,
					uploaded: true,
					error: "",
				});
				await finishUpload(reservation.id, item.completeKey, () =>
					update(item.id, { state: "processing" }),
				);
				ensureSession();
				signal.throwIfAborted();
				update(item.id, { state: "ready", progress: 100, error: "" });
				notifyReady(item, reservation.id);
			});
		} catch (e) {
			if (signal.aborted) return;
			update(item.id, {
				state: "failed",
				terminal: [
					"UPLOAD_WINDOW_EXPIRED",
					"FILE_REJECTED",
					"INVALID_IMAGE",
					"MAGIC_MISMATCH",
					"HASH_OR_SIZE_MISMATCH",
					"ZIP_UNSAFE",
				].includes((e as { code?: string }).code ?? ""),
				error: e instanceof Error ? e.message : "上传失败，请重试。",
			});
			if ((e as { status?: number }).status === 401) invalidRef.current();
		} finally {
			running.current.delete(item.id);
		}
	}
	async function select(files: FileList | null) {
		if (archived) return;
		if (!files) return;
		if (
			files.length +
				itemsRef.current.filter((item) => item.state !== "ready").length >
			20
		) {
			setError("当前上传队列最多 20 个文件，请等部分完成后再选择。");
			return;
		}
		setError("");
		const batch = Array.from(files).map((file) => ({
			id: crypto.randomUUID(),
			file,
			key: crypto.randomUUID(),
			completeKey: crypto.randomUUID(),
			progress: 0,
			state: "waiting" as const,
			error: "",
		}));
		setItems((old) => [
			...old.filter((item) => item.state !== "ready"),
			...batch,
		]);
		await Promise.allSettled(batch.map((item) => send(item)));
	}
	const showEmptyHint =
		!!emptyHint &&
		!error &&
		!tracked.length &&
		!items.some((item) => item.state !== "ready");
	const uploadEntry = (
		<div ref={dock} className={entryTarget ? "workspace-upload-entry" : "workspace-upload-dock"}>
			{chooser.mounted && !archived ? (
				<div className="workspace-upload-menu" data-phase={chooser.phase} inert={chooser.phase === "closing"}>
					<button type="button" onClick={() => { camera.current?.click(); chooser.hide(); }}>
						<WorkspaceIcon kind="camera" />拍照
					</button>
					<button type="button" onClick={() => { picker.current?.click(); chooser.hide(); }}>
						<WorkspaceIcon kind="file" />文件
					</button>
					<button type="button" onClick={() => { album.current?.click(); chooser.hide(); }}>
						<WorkspaceIcon kind="album" />相册
					</button>
				</div>
			) : null}
			<button type="button" className="primary workspace-upload-trigger" disabled={archived}
				aria-expanded={chooser.expanded}
				onClick={() => {
					if (window.matchMedia("(max-width: 700px)").matches) {
						if (chooser.expanded) chooser.hide(); else chooser.show();
					} else picker.current?.click();
				}}>
				<WorkspaceIcon kind="upload" />上传
			</button>
		</div>
	);
	return (
		<section
			className={`uploads ${floating ? "workspace-uploads" : ""} ${compact ? "uploads-compact" : ""}`}
			aria-label={purpose === "delivery" ? "上传成果附件" : "上传资料"}
		>
			{archived ? <p className="muted">项目已归档，上传已暂停。</p> : null}
			<div hidden={archived}>
				{compact ? (
					<div className="upload-compact-entry" data-empty={showEmptyHint}>
						<div
							className="upload-compact-hint"
							data-visible={showEmptyHint}
							aria-hidden={!showEmptyHint}
						>
							<p className="muted">{emptyHint || "上传文件，开始交付"}</p>
						</div>
						<input
							ref={(element) => {
								picker.current = element;
								if (pickerRef) pickerRef.current = element;
							}}
							type="file"
							hidden
							multiple
							aria-label="选择成果文件"
							accept=".jpg,.jpeg,.png,.webp,.pdf,.step,.stp,.sldprt,.sldasm,.stl,.dxf,.dwg,.zip"
							onChange={(event) => {
								void select(event.target.files);
								event.target.value = "";
							}}
						/>
						<button
							type="button"
							className="delivery-upload-icon"
							aria-label="上传成果文件"
							title="上传成果文件"
							onClick={() => picker.current?.click()}
						>
							<WorkspaceIcon kind="upload" />
							{buttonLabel ? <span>{buttonLabel}</span> : null}
						</button>
					</div>
				) : !floating ? (
					<>
						<h2>{purpose === "delivery" ? "上传成果附件" : "上传资料"}</h2>
						<label className="file-picker">
							拍照 / 选择照片或附件
							<input
								aria-label="选择上传文件"
								type="file"
								multiple
								accept=".jpg,.jpeg,.png,.webp,.pdf,.step,.stp,.sldprt,.sldasm,.stl,.dxf,.dwg,.zip"
								onChange={(e) => {
									void select(e.target.files);
									e.target.value = "";
								}}
							/>
						</label>
					</>
				) : (
					<>
						<input
							ref={(element) => {
								picker.current = element;
								if (pickerRef) pickerRef.current = element;
							}}
							type="file"
							multiple
							hidden
							aria-label="选择资料文件"
							accept=".jpg,.jpeg,.png,.webp,.pdf,.step,.stp,.sldprt,.sldasm,.stl,.dxf,.dwg,.zip"
							onChange={(event) => {
								void select(event.target.files);
								event.target.value = "";
							}}
						/>
						<input
							ref={camera}
							type="file"
							hidden
							aria-label="拍摄资料照片"
							accept="image/jpeg,image/png,image/webp"
							capture="environment"
							onChange={(event) => {
								void select(event.target.files);
								event.target.value = "";
							}}
						/>
						<input
							ref={album}
							type="file"
							multiple
							hidden
							aria-label="选择资料照片"
							accept="image/jpeg,image/png,image/webp"
							onChange={(event) => {
								void select(event.target.files);
								event.target.value = "";
							}}
						/>
						{entryTarget ? createPortal(uploadEntry, entryTarget) : uploadEntry}
					</>
				)}
			</div>
			{error ? (
				<p role="alert" className="error">
					{error}
				</p>
			) : null}
			<ul className="queue" aria-live="polite">
				{tracked
					.filter((r) => !items.some((i) => i.reservationId === r.id))
					.map((r) => (
						<li key={r.id}>
							<span>{r.filename}</span>
							<small>
								{r.state === "reserved"
									? "传输尚未确认，请重新选择同一文件继续。"
									: r.state === "rejected"
										? "处理未完成，请重新选择文件。"
										: r.processingActive
											? "正在校验文件/处理图片。"
											: r.canProcess === false
												? "等待上传者继续处理已上传文件。"
												: "文件已上传，点击继续处理即可使用，无需重新上传。"}
							</small>
							{r.errorCode ? (
								<p className="error">{message(r.errorCode)}</p>
							) : null}
							{r.canProcess !== false &&
							!r.processingActive &&
							(r.state === "queued" || r.state === "processing") ? (
								<button
									disabled={archived}
									type="button"
									onClick={async () => {
										try {
											await finishUpload(r.id, crypto.randomUUID(), () => {});
											setTracked((old) => old.filter((x) => x.id !== r.id));
											readyRef.current();
											setError("");
										} catch (e) {
											if ((e as { status?: number }).status === 401)
												invalidRef.current();
											setError(
												e instanceof Error
													? e.message
													: "处理重试未完成，请稍后重试。",
											);
										}
									}}
								>
									继续处理
								</button>
							) : null}
						</li>
					))}
				{items
					.filter((item) => (!floating && !compact) || item.state !== "ready")
					.map((item) => (
						<li key={item.id}>
							<span>{item.file.name}</span>
							{item.state === "uploading" ? (
								<progress
									max="100"
									value={item.progress}
									aria-label={`${item.file.name} 上传进度`}
								/>
							) : null}
							<small>
								{
									{
										waiting: "等待传输",
										checking: "校验文件",
										reserving: "准备上传名额",
										processing_wait: "传输完成 · 等待处理",
										uploading: `传输 ${item.progress}%`,
										processing: "传输完成 · 校验文件/处理图片",
										ready:
											purpose === "delivery"
												? "已完成 · 仅工程师可见，发布后开放客户"
												: "已完成 · 工程师和客户可查看",
										failed: "未完成",
									}[item.state]
								}
							</small>
							{item.error ? <p className="error">{item.error}</p> : null}
							{item.state === "processing" && item.error ? (
								<button
									disabled={archived}
									type="button"
									onClick={async () => {
										try {
											await api(
												`${base}/uploads/${item.reservationId}/retry`,
												"POST",
												{},
											);
											update(item.id, { error: "" });
										} catch (e) {
											update(item.id, {
												error:
													e instanceof Error ? e.message : "暂时无法重试处理。",
											});
										}
									}}
								>
									重试文件处理
								</button>
							) : null}
							{item.state === "failed" ? (
								<button
									type="button"
									disabled={archived}
									onClick={() => void send(item)}
								>
									重试此文件
								</button>
							) : null}
						</li>
					))}
			</ul>
		</section>
	);
}
