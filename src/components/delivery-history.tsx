"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { type Delivery, type DeliveryHistoryPage, versionLabel } from "@/lib/deliveries";
import { api, ApiError } from "./api";
import { DeliveryContents } from "./delivery-version";
import { useApiRevalidation } from "./use-api-revalidation";
import type { FeedbackDirtyHandler } from "./delivery-feedback";

export function DeliveryHistory({ base, beforeVersion, visible, guest, onInvalid, onFeedbackDirty, allowFeedbackLeave }: {
	base: string;
	beforeVersion: number;
	visible: boolean;
	onInvalid: () => void;
	guest: boolean;
	onFeedbackDirty: FeedbackDirtyHandler;
	allowFeedbackLeave: (id: string) => boolean;
}) {
	const region = useId();
	const [open, setOpen] = useState(false);
	const [page, setPage] = useState<DeliveryHistoryPage | null>(null);
	const [trail, setTrail] = useState<(string | null)[]>([null]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const path = useRef<(string | null)[]>([null]);
	const pendingPath = useRef<(string | null)[]>([null]);
	const run = useRef(0);
	const reading = useRef<AbortController | null>(null);
	const invalid = useRef(onInvalid);
	invalid.current = onInvalid;
	const load = useCallback(async (nextPath: (string | null)[], refresh = false) => {
		const generation = ++run.current;
		reading.current?.abort();
		const controller = new AbortController();
		reading.current = controller;
		pendingPath.current = nextPath;
		setBusy(true);
		setError("");
		const cursor = nextPath.at(-1);
		const params = new URLSearchParams({ view: "history", beforeVersion: String(beforeVersion) });
		if (cursor) params.set("cursor", cursor);
		try {
			const data = await api<DeliveryHistoryPage>(`${base}/deliveries?${params}`, "GET", undefined, { signal: controller.signal, refresh });
			if (generation !== run.current) return;
			setPage(data);
			setTrail(nextPath);
			path.current = nextPath;
			setSelected(old => data.items.some(item => item.id === old) ? old : null);
		} catch (e) {
			if (generation !== run.current || controller.signal.aborted) return;
			if (e instanceof ApiError && e.status === 401) invalid.current();
			setError(e instanceof Error ? e.message : "读取历史版本失败。");
		} finally {
			if (generation === run.current) setBusy(false);
		}
	}, [base, beforeVersion]);
	useEffect(() => {
		if (open && visible) void load(path.current);
		return () => { run.current++; reading.current?.abort(); };
	}, [load, open, visible]);
	useApiRevalidation(() => { if (open && visible) void load(path.current); });
	const leaveSelected = () => !selected || allowFeedbackLeave(selected);
	return <section className="delivery-history" aria-label="历史交付版本">
		<button type="button" className="delivery-history-toggle" aria-expanded={open} aria-controls={region} onClick={() => { if (!open || leaveSelected()) setOpen(value => !value); }}>
			<span aria-hidden="true">{open ? "▾" : "▸"}</span> 历史版本
		</button>
		{open ? <div id={region} aria-busy={busy}>
			{busy ? <p role="status">读取历史版本…</p> : null}
			{error ? <p role="alert" className="error">{error} <button type="button" onClick={() => void load(pendingPath.current, true)}>重试读取历史</button></p> : null}
			{!busy && !error && page?.items.length === 0 ? <p className="empty">暂无更早版本</p> : null}
			<ul className="delivery-history-list">
				{page?.items.map(item => <li key={item.id}>
					<button type="button" className="delivery-version-toggle" aria-expanded={selected === item.id} aria-controls={`${region}-${item.id}`} disabled={busy} onClick={() => { if (leaveSelected()) setSelected(old => old === item.id ? null : item.id); }}>
						<span><strong>{versionLabel(item.versionNo ?? 1)}</strong><small><time dateTime={item.publishedAt ?? item.createdAt}>{new Date(item.publishedAt ?? item.createdAt).toLocaleString("zh-CN")}</time> · {item.fileCount}份附件</small></span>
						<span>{selected === item.id ? "收起" : "展开"}</span>
					</button>
					{selected === item.id ? <div id={`${region}-${item.id}`}>
						<HistoryDetail key={`${base}:${item.id}`} base={base} id={item.id} visible={visible} guest={guest} onInvalid={onInvalid} onFeedbackDirty={onFeedbackDirty} />
					</div> : null}
				</li>)}
			</ul>
			{page && (trail.length > 1 || page.nextCursor) ? <nav className="delivery-history-pages" aria-label="历史版本分页">
				<button type="button" disabled={busy || trail.length === 1} onClick={() => { if (leaveSelected()) void load(trail.slice(0, -1)); }}>上一页</button>
				<span>第{trail.length}页</span>
				<button type="button" disabled={busy || !page.nextCursor} onClick={() => { if (page.nextCursor && leaveSelected()) void load([...trail, page.nextCursor]); }}>更早版本</button>
			</nav> : null}
		</div> : null}
	</section>;
}

function HistoryDetail({ base, id, visible, guest, onInvalid, onFeedbackDirty }: { base: string; id: string; visible: boolean; guest: boolean; onInvalid: () => void; onFeedbackDirty: FeedbackDirtyHandler }) {
	const [delivery, setDelivery] = useState<Delivery | null>(null);
	const [error, setError] = useState("");
	const [retry, setRetry] = useState(0);
	const invalid = useRef(onInvalid);
	invalid.current = onInvalid;
	useEffect(() => {
		if (!visible) return;
		const controller = new AbortController();
		setError("");
		void api<Delivery>(`${base}/deliveries/${id}`, "GET", undefined, { signal: controller.signal, refresh: retry > 0 }).then(data => {
			if (!controller.signal.aborted) setDelivery(data);
		}).catch(e => {
			if (controller.signal.aborted) return;
			if (e instanceof ApiError && e.status === 401) invalid.current();
			setError(e instanceof Error ? e.message : "读取版本附件失败。");
		});
		return () => controller.abort();
	}, [base, id, visible, retry]);
	return <div className="delivery-history-detail">
		{error ? <p role="alert" className="error">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>重试读取附件</button></p>
			: delivery ? <DeliveryContents delivery={delivery} base={base} guest={guest} visible={visible} onInvalid={onInvalid} onFeedbackDirty={onFeedbackDirty} /> : <p role="status">读取本版本附件…</p>}
	</div>;
}
