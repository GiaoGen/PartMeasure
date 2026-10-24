"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { emptyMetadata, validateAnnotation, type CanonicalImage, type Geometry } from "@/lib/annotations";
import { CV_MAX_CANDIDATES, cvGeometry, cvRaster } from "@/lib/cv/protocol";
import type { CvClient } from "@/lib/cv/client";
import type { CvDraftTicket } from "@/lib/cv/draft";
import { onApiSessionCleared } from "./api";
import { onPrivateImageInvalidated } from "./private-image-cache";

export function useCvAssistance(options: {
	image: CanonicalImage; src: string; bitmap: HTMLImageElement | null; allowed: boolean;
	apply: ((ticket: CvDraftTicket, geometry: Geometry) => boolean) | undefined;
}) {
	const latest = useRef(options); latest.current = options;
	const client = useRef<CvClient | null>(null), pending = useRef<AbortController | null>(null), generation = useRef(0);
	const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState("");
	const [candidates, setCandidates] = useState<{ id: string; geometry: Geometry }[]>([]);
	const cancel = useCallback((clear = false) => {
		generation.current++;
		pending.current?.abort(); pending.current = null;
		client.current?.cancel();
		setBusy(false);
		if (clear) setCandidates([]);
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the identity dependencies deliberately dispose private pixels and reset assistance on photo changes.
	useEffect(() => {
		setEnabled(false); setStatus(""); cancel(true);
		return () => { generation.current++; pending.current?.abort(); client.current?.cancel(); };
	}, [options.src, options.image.id, options.image.imageHash, cancel]);
	useEffect(() => {
		if (!options.allowed) { cancel(true); setEnabled(false); setStatus(""); }
	}, [options.allowed, cancel]);
	useEffect(() => {
		const revoke = () => { cancel(true); setEnabled(false); setStatus(""); };
		const offSession = onApiSessionCleared(revoke);
		const offImage = onPrivateImageInvalidated(prefix => { if (latest.current.src.startsWith(prefix) || prefix.startsWith(latest.current.src)) revoke(); });
		return () => { offSession(); offImage(); };
	}, [cancel]);
	async function compute(ticket?: CvDraftTicket) {
		const current = latest.current;
		if (!current.allowed || !current.bitmap || ticket && !enabled) return;
		pending.current?.abort();
		const controller = new AbortController(); pending.current = controller;
		const run = ++generation.current;
		setBusy(true); setStatus("正在准备辅助，可取消；原画仍可编辑。");
		try {
			const { CvClient } = await import("@/lib/cv/client");
			if (controller.signal.aborted || generation.current !== run) return;
			client.current ??= new CvClient();
			const raster = cvRaster(current.image.width, current.image.height);
			const canvas = document.createElement("canvas"); canvas.width = raster.width; canvas.height = raster.height;
			const context = canvas.getContext("2d", { willReadFrequently: true });
			if (!context || current.bitmap.naturalWidth !== current.image.width || current.bitmap.naturalHeight !== current.image.height) throw Error("CV_IMAGE_NOT_READY");
			context.drawImage(current.bitmap, 0, 0, current.image.width * raster.scale, current.image.height * raster.scale);
			const pixels = context.getImageData(0, 0, raster.width, raster.height);
			canvas.width = canvas.height = 0;
			const result = await client.current.run({ rgba: pixels.data.buffer as ArrayBuffer, width: raster.width, height: raster.height,
				drafts: ticket ? [cvGeometry(ticket.geometry, raster, "to-raster")] : [], candidates: !ticket }, controller.signal);
			if (controller.signal.aborted || generation.current !== run || !latest.current.allowed || latest.current.image.imageHash !== current.image.imageHash || latest.current.src !== current.src) return;
			const valid = (g: Geometry) => { try { validateAnnotation(g, emptyMetadata(), current.image.width, current.image.height); return true; } catch { return false; } };
			if (ticket) {
				const fit = result.locals[0];
				const output = fit?.changed ? cvGeometry(fit.output, raster, "to-canonical") : null;
				if (!output || !valid(output)) setStatus("无可靠匹配，保留原画，可继续手动调整。");
				else if (latest.current.apply?.(ticket, output)) setStatus("已尝试贴合；可撤销恢复原画，尺寸仍需人工填写。");
				else setStatus("当前编辑已保留，未应用迟到的贴合结果。");
			} else {
				const usable = result.candidates.slice(0, CV_MAX_CANDIDATES).filter(g => g.type === "circle" || g.type === "ellipse")
					.map(g => cvGeometry(g, raster, "to-canonical")).filter(valid).map((geometry, i) => ({ id: `${run}:${i}`, geometry }));
				setCandidates(usable);
				setStatus(usable.length ? `找到 ${usable.length} 个候选轮廓，选用后可手调并保存；候选不代表孔。` : "未找到可靠圆／椭圆候选，可继续手动标注。");
			}
		} catch (error) {
			if (generation.current === run && !controller.signal.aborted) {
				client.current?.cancel();
				setStatus(error instanceof DOMException && error.name === "AbortError" ? "已取消，原画保留。" : "辅助暂不可用，原画保留；可继续手动或重试。");
			}
		} finally {
			if (generation.current === run) { pending.current = null; setBusy(false); }
		}
	}
	return {
		enabled, busy, status, candidates,
		toggle: () => { if (!latest.current.allowed) return; if (enabled) cancel(); setEnabled(!enabled); setStatus(enabled ? "已关闭边缘贴合，继续手动标注。" : "已开启边缘贴合，仅辅助新画的线段、角度、圆与椭圆。"); },
		fit: (ticket: CvDraftTicket) => { if (["line", "angle", "circle", "ellipse"].includes(ticket.geometry.type)) void compute(ticket); },
		detect: () => void compute(),
		cancel: () => { cancel(); setStatus("已取消辅助，原画保留。"); },
		clear: () => { cancel(true); setStatus(""); },
		adopt: (id: string) => setCandidates(previous => previous.filter(c => c.id !== id)),
	};
}
