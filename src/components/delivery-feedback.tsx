"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { type FeedbackInput, type FeedbackPage, feedbackInputSchema, feedbackKindLabel } from "@/lib/delivery-feedback";
import { versionLabel } from "@/lib/deliveries";
import { api, ApiError } from "./api";
import { useProjectUpdates } from "./project-live";
import { useApiRevalidation } from "./use-api-revalidation";

export type FeedbackDirtyHandler = (deliveryId: string, dirty: boolean) => void;
export function DeliveryFeedbackSection({ base, deliveryId, versionNo, guest, visible, onInvalid, onDirty }: {
	base: string; deliveryId: string; versionNo: number; guest: boolean; visible: boolean;
	onInvalid: () => void; onDirty: FeedbackDirtyHandler;
}) {
	const heading = useId();
	const [page, setPage] = useState<FeedbackPage | null>(null);
	const [trail, setTrail] = useState<(string | null)[]>([null]);
	const [history, setHistory] = useState(false);
	const [loading, setLoading] = useState(false);
	const [readError, setReadError] = useState("");
	const [body, setBody] = useState("");
	const [label, setLabel] = useState("");
	const [changed, setChanged] = useState(false);
	const [busy, setBusy] = useState(false);
	const [writeError, setWriteError] = useState("");
	const [notice, setNotice] = useState("");
	const [blocked, setBlocked] = useState(false);
	const path = useRef<(string | null)[]>([null]);
	const pendingPath = useRef<(string | null)[]>([null]);
	const reading = useRef<AbortController | null>(null);
	const generation = useRef(0);
	const pending = useRef<{ input: FeedbackInput; key: string } | null>(null);
	const running = useRef(false);
	const alive = useRef(true);
	const callbacks = useRef({ onInvalid, onDirty });
	callbacks.current = { onInvalid, onDirty };
	const url = `${base}/deliveries/${deliveryId}/feedback`;
	const dirty = changed || busy || blocked;
	useEffect(() => {
		callbacks.current.onDirty(deliveryId, dirty);
		return () => callbacks.current.onDirty(deliveryId, false);
	}, [deliveryId, dirty]);
	useEffect(() => {
		alive.current = true;
		return () => { alive.current = false; };
	}, []);
	useEffect(() => {
		const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
		window.addEventListener("beforeunload", guard);
		return () => window.removeEventListener("beforeunload", guard);
	}, [dirty]);
	const load = useCallback(async (nextPath: (string | null)[] = [null], refresh = false) => {
		const run = ++generation.current;
		reading.current?.abort();
		const controller = new AbortController();
		reading.current = controller;
		pendingPath.current = nextPath;
		setLoading(true); setReadError("");
		const cursor = nextPath.at(-1);
		try {
			const data = await api<FeedbackPage>(`${url}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, "GET", undefined, { signal: controller.signal, refresh });
			if (run !== generation.current) return;
			setPage(data); setTrail(nextPath); path.current = nextPath;
		} catch (error) {
			if (run !== generation.current || controller.signal.aborted) return;
			if (error instanceof ApiError && error.status === 401) callbacks.current.onInvalid();
			setReadError(error instanceof Error ? error.message : "读取反馈失败。");
		} finally { if (run === generation.current) setLoading(false); }
	}, [url]);
	useEffect(() => {
		if (visible) void load(path.current);
		return () => { generation.current++; reading.current?.abort(); };
	}, [load, visible]);
	useApiRevalidation(() => { if (visible) void load(path.current); });
	useProjectUpdates(updates => {
		if (visible && updates.some(event => event.kind === "resync" || event.kind === "delivery.changed" && event.entityId === deliveryId)) void load(path.current);
	});
	async function submit(input: FeedbackInput) {
		if (running.current) return;
		const parsed = feedbackInputSchema.safeParse(input);
		if (!parsed.success) { setWriteError("请填写留言（最多4000字），称呼最多80字。"); return; }
		const operation = pending.current ?? { input: parsed.data, key: crypto.randomUUID() };
		pending.current = operation; running.current = true;
		setBusy(true); setWriteError(""); setNotice("");
		try {
			await api(url, "POST", operation.input, { key: operation.key });
			pending.current = null;
			if (!alive.current) return;
			setBlocked(false);
			if (operation.input.kind !== "withdrawn") { setBody(""); setChanged(false); }
			setNotice(`${versionLabel(versionNo)} · ${feedbackKindLabel[operation.input.kind]}已记录。`);
			setHistory(false);
			await load([null], true);
		} catch (error) {
			if (!alive.current) return;
			if (error instanceof ApiError && error.status < 500) {
				pending.current = null; setBlocked(false);
				if (error.status === 409) void load(path.current, true);
			} else setBlocked(true);
			if (error instanceof ApiError && error.status === 401) callbacks.current.onInvalid();
			setWriteError(error instanceof Error ? error.message : "提交未完成，输入已保留。");
		} finally { running.current = false; if (alive.current) setBusy(false); }
	}
	const input = (kind: FeedbackInput["kind"]): FeedbackInput => ({ kind, body, guestLabel: label });
	const items = history ? page?.items : page?.items.slice(0, 3);
	return <section className="delivery-feedback" aria-labelledby={heading}>
		<h4 id={heading}>客户反馈与接收 · {versionLabel(versionNo)}</h4>
		{page ? <p className="muted">有效记录：已收到 {page.receipts.received} · 接受 {page.receipts.accepted}<small>按客户访问记录统计；接受不代表工程质量验收。</small></p> : null}
		{loading ? <p role="status">读取反馈…</p> : null}
		{readError ? <p role="alert" className="error">{readError} <button type="button" onClick={() => void load(pendingPath.current, true)}>重试读取反馈</button></p> : null}
		{page?.total === 0 ? <p className="muted">暂无客户反馈或接收记录。</p> : null}
		<ol className="delivery-feedback-list">
			{items?.map(item => <li key={item.id}>
				<p className="delivery-feedback-meta"><strong>客户{item.guestLabel ? ` ${item.guestLabel}` : ""}</strong> · {feedbackKindLabel[item.kind]}{item.receiptState === "withdrawn" ? "（已撤销）" : item.receiptState === "superseded" ? "（历史记录）" : ""}<small><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("zh-CN")}</time></small></p>
				{item.body ? <p className="preserve-lines">{item.body}</p> : null}
			</li>)}
		</ol>
		{page && (page.total > 3 || trail.length > 1) ? <button type="button" aria-expanded={history} onClick={() => setHistory(value => !value)}>{history ? "收起更早记录" : "更早记录"}</button> : null}
		{history && page && (trail.length > 1 || page.nextCursor) ? <nav className="delivery-history-pages" aria-label={`${versionLabel(versionNo)}反馈分页`}>
			<button type="button" disabled={loading || trail.length === 1} onClick={() => void load(trail.slice(0, -1))}>较新记录</button>
			<button type="button" disabled={loading || !page.nextCursor} onClick={() => { if (page.nextCursor) void load([...trail, page.nextCursor]); }}>更早一页</button>
		</nav> : null}
		{trail.length > 1 ? <button type="button" disabled={loading} onClick={() => void load([null], true)}>查看最新记录</button> : null}
		{guest ? <form className="delivery-feedback-form" onSubmit={event => { event.preventDefault(); void submit(input("comment")); }}>
			<fieldset disabled={busy || blocked}>
				<label>客户称呼（可选）<input value={label} maxLength={80} onChange={event => { setLabel(event.target.value); setChanged(true); }} /></label>
				<label>对 {versionLabel(versionNo)} 的留言／说明<textarea value={body} maxLength={4000} onChange={event => { setBody(event.target.value); setChanged(true); }} /></label>
				<div className="delivery-feedback-actions">
					<button type="submit" disabled={!body.trim()}>提交留言</button>
					<button type="button" disabled={!page || !!page.myReceipt} onClick={() => void submit(input("received"))}>已收到</button>
					<button type="button" disabled={!page || page.myReceipt?.kind === "accepted"} onClick={() => void submit(input("accepted"))}>接受本版</button>
				</div>
				{page?.myReceipt ? <p>本次记录：{feedbackKindLabel[page.myReceipt.kind]} <button type="button" onClick={() => {
					if (page.myReceipt && window.confirm(`撤销本次访问对 ${versionLabel(versionNo)} 的接收记录？原记录仍保留。`)) void submit({ kind: "withdrawn", body: "", guestLabel: label, targetId: page.myReceipt.id });
				}}>撤销本次记录</button></p> : null}
			</fieldset>
			<small>称呼仅作来源说明；可撤销本次访问提交的接收记录。留言更正请追加说明。</small>
			{busy ? <p role="status">正在提交…</p> : null}
			{writeError ? <p role="alert" className="error">{writeError}</p> : null}
			{blocked ? <button type="button" disabled={busy} onClick={() => { if (pending.current) void submit(pending.current.input); }}>重试上次提交</button> : null}
			{notice ? <p role="status">{notice}</p> : null}
		</form> : null}
	</section>;
}
