"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, message } from "./api";
import { useProjectUpdates } from "./project-live";
import { fileHash } from "./file-hash";
import { WorkspaceIcon, useWorkspaceDisclosure } from "./workspace-ui";
type Item = {
	id: string;
	file: File;
	key: string;
	completeKey: string;
	progress: number;
	state: "waiting" | "uploading" | "processing" | "ready" | "failed";
	error: string;
	reservationId?: string;
	terminal?: boolean;
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
};
export function UploadQueue({
	base,
	onReady,
	onInvalid,
	purpose = "material",
	floating = false,
	compact = false,
	emptyHint,
}: {
	base: string;
	onReady: () => void;
	onInvalid: () => void;
	purpose?: "material" | "delivery";
	floating?: boolean;
	compact?: boolean;
	emptyHint?: string | undefined;
}) {
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

	const [tracked, setTracked] = useState<Tracked[]>([]);
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
				if ((e as { status?: number }).status === 401) invalidRef.current();
			} finally {
				busy = false;
			}
		}
        recoverRef.current = () => { void recover(); };
        void recover();
        return () => { active = false; recoverRef.current = () => {}; };
	}, [base, purpose]);
	const update = useCallback(
		(id: string, changes: Partial<Item>) =>
			setItems((old) =>
				old.map((item) => (item.id === id ? { ...item, ...changes, ...(item.state === "ready" && changes.state === "processing" ? { state: "ready" as const } : {}) } : item)),
			),
		[],
	);
 useProjectUpdates(updates => {
  for (const e of updates) {
   if (e.kind === "resync") {
    readyRef.current();
    recoverRef.current();
    for (const item of itemsRef.current.filter(i => i.state === "processing" && i.reservationId)) {
     void api<{state: string;errorCode: string|null}>(`${base}/uploads/${item.reservationId}`).then(r => {
      if (r.state === "ready") update(item.id, {state: "ready", error: ""});
      else if (["rejected","cleaned"].includes(r.state)) update(item.id, {state:"failed",terminal:true,error:message(r.errorCode ?? "FILE_REJECTED")});
     }).catch(e => { if (e.status === 401) invalidRef.current(); });
    }
   }
   if (e.kind !== "upload.changed") continue;
   if (e.state === "ready") readyRef.current();
   const item = itemsRef.current.find(i => i.reservationId === e.entityId);
   if (item && e.state === "ready") update(item.id, {state:"ready",error:""});
   else if (item && ["rejected","cleaned"].includes(e.state ?? "")) update(item.id, {state:"failed",terminal:true,error:"文件处理未完成，请重试或联系工程师。"});
   if (e.state === "ready" || e.state === "cleaned") setTracked(old => old.filter(x => x.id !== e.entityId));
   else if (e.state) { const state=e.state; setTracked(old => old.map(x => x.id === e.entityId ? {...x,state} : x)); }
  }
 });

	async function send(item: Item) {
		if (item.terminal) {
			item = {
				...item,
				key: crypto.randomUUID(),
				completeKey: crypto.randomUUID(),
				terminal: false,
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
		update(item.id, { state: "uploading", error: "" });
		try {
			const hash = await fileHash(item.file);
			const reservation = await api<{ id: string }>(
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
			);
			update(item.id, { reservationId: reservation.id });
			const grant = await api<Grant>(
				`${base}/uploads/${reservation.id}/grant`,
				"POST",
			);
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
								update(item.id, { progress: Math.round((sent / total) * 100) }),
							onError: () => reject(new Error("文件传输失败，请重试。")),
							onSuccess: () => resolve(),
						});
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
						xhr.onerror = () => reject(new Error("网络中断，请重试。"));
						xhr.timeout = 120000;
						xhr.ontimeout = () => reject(new Error("上传超时，请重试。"));
						xhr.onload = () => {
							if (xhr.status >= 200 && xhr.status < 300) resolve();
							else if (xhr.status === 409) resolve();
							else reject(new Error("传输失败，请检查网络后重试。"));
						};
						xhr.send(item.file);
					});
			}
			await api(
				`${base}/uploads/${reservation.id}/complete`,
				"POST",
				{},
				{ key: item.completeKey },
			);
			update(item.id, { state: "processing", progress: 100, error: "" });
		} catch (e) {
			update(item.id, {
				state: "failed",
				terminal: (e as { code?: string }).code === "UPLOAD_WINDOW_EXPIRED",
				error: e instanceof Error ? e.message : "上传失败，请重试。",
			});
			if ((e as { status?: number }).status === 401) invalidRef.current();
		} finally {
			running.current.delete(item.id);
		}
	}
	async function select(files: FileList | null) {
		if (!files) return;
		if (files.length > 20) {
			setError("每批最多 20 个文件，请分批选择。");
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
		setItems((old) => [...old, ...batch]);
		for (const item of batch) await send(item);
	}
	const showEmptyHint =
		!!emptyHint &&
		!error &&
		!tracked.length &&
		!items.some((item) => item.state !== "ready");
	return (
		<section
			className={`uploads ${floating ? "workspace-uploads" : ""} ${compact ? "uploads-compact" : ""}`}
			aria-label={purpose === "delivery" ? "上传成果附件" : "上传资料"}
		>
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
						ref={picker}
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
						ref={picker}
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
					<div ref={dock} className="workspace-upload-dock">
						{chooser.mounted ? (
							<div
								className="workspace-upload-menu"
								data-phase={chooser.phase}
								inert={chooser.phase === "closing"}
							>
								<button
									type="button"
									onClick={() => {
										camera.current?.click();
										chooser.hide();
									}}
								>
									<WorkspaceIcon kind="camera" />
									拍照
								</button>
								<button
									type="button"
									onClick={() => {
										picker.current?.click();
										chooser.hide();
									}}
								>
									<WorkspaceIcon kind="file" />
									文件
								</button>
								<button
									type="button"
									onClick={() => {
										album.current?.click();
										chooser.hide();
									}}
								>
									<WorkspaceIcon kind="album" />
									相册
								</button>
							</div>
						) : null}
						<button
							type="button"
							className="primary workspace-upload-trigger"
							aria-expanded={chooser.expanded}
							onClick={() => {
								if (window.matchMedia("(max-width: 700px)").matches) {
									if (chooser.expanded) chooser.hide();
									else chooser.show();
								} else picker.current?.click();
							}}
						>
							<WorkspaceIcon kind="upload" />
							上传
						</button>
					</div>
				</>
			)}
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
										: "安全处理中，刷新后状态仍会保留。"}
							</small>
							{r.errorCode ? (
								<p className="error">{message(r.errorCode)}</p>
							) : null}
							{r.errorCode &&
							(r.state === "queued" || r.state === "processing") ? (
								<button
									type="button"
									onClick={async () => {
										try {
											await api(`${base}/uploads/${r.id}/retry`, "POST", {});
											setTracked((old) =>
												old.map((x) =>
													x.id === r.id ? { ...x, errorCode: null } : x,
												),
											);
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
									重试处理
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
										uploading: `传输 ${item.progress}%`,
										processing: "传输完成 · 安全处理中",
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
									重试安全处理
								</button>
							) : null}
							{item.state === "failed" ? (
								<button type="button" onClick={() => void send(item)}>
									重试此文件
								</button>
							) : null}
						</li>
					))}
			</ul>
		</section>
	);
}
