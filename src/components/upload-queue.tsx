"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, message } from "./api";
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
}: {
	base: string;
	onReady: () => void;
	onInvalid: () => void;
	purpose?: "material" | "delivery";
}) {
	const [items, setItems] = useState<Item[]>([]),
		[error, setError] = useState("");
	const running = useRef(new Set<string>());
	const polling = useRef(new Set<string>());
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
					readyRef.current();
				}
			} catch (e) {
				if ((e as { status?: number }).status === 401) invalidRef.current();
			} finally {
				busy = false;
			}
		}
		void recover();
		const timer = setInterval(() => {
			if (!document.hidden) void recover();
		}, 30000);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, [base, purpose]);
	const update = useCallback(
		(id: string, changes: Partial<Item>) =>
			setItems((old) =>
				old.map((item) => (item.id === id ? { ...item, ...changes } : item)),
			),
		[],
	);
	useEffect(() => {
		const timer = setInterval(() => {
			for (const item of itemsRef.current.filter(
				(i) => i.state === "processing",
			)) {
				if (polling.current.has(item.id)) continue;
				polling.current.add(item.id);
				void api<{ state: string; errorCode: string | null }>(
					`${base}/uploads/${item.reservationId}`,
				)
					.then((result) => {
						if (result.state === "ready") {
							update(item.id, { state: "ready", error: "" });
							readyRef.current();
						} else if (
							result.state === "rejected" ||
							result.state === "cleaned"
						)
							update(item.id, {
								state: "failed",
								terminal: true,
								error: message(result.errorCode ?? "FILE_REJECTED"),
							});
						else if (result.errorCode)
							update(item.id, { error: message(result.errorCode) });
					})
					.catch((e) => {
						if (e.status === 401) invalidRef.current();
						else
							update(item.id, {
								error: "暂时无法查询处理结果，稍后自动重试。",
							});
					})
					.finally(() => polling.current.delete(item.id));
			}
		}, 5000);
		return () => clearInterval(timer);
	}, [base, update]);
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
			const hash = Array.from(
				new Uint8Array(
					await crypto.subtle.digest("SHA-256", await item.file.arrayBuffer()),
				),
			)
				.map((n) => n.toString(16).padStart(2, "0"))
				.join("");
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
	return (
		<section
			className="uploads"
			aria-label={purpose === "delivery" ? "上传成果附件" : "上传资料"}
		>
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
			<p className="muted">
				<small>
					照片 ≤20 MiB；PDF / CAD / ZIP 在当前测试环境最多{" "}
					{(maxFileBytes / 1024 / 1024).toFixed(0)} MiB，每批最多 20 个。HEIC
					请先转 JPG。文件扫描和处理完成后才可查看。
				</small>
			</p>
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
				{items.map((item) => (
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
