"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { useProjectReadOnly } from "./project-read-only";
import { useActionLifetime } from "./use-action-lifetime";

export function useIssueWrite<T = unknown>(
	url: string,
	revision: number | undefined,
	onSuccess: (result: T) => void,
	onInvalid: () => void,
	onDirty?: (dirty: boolean) => void,
	method: "POST" | "PATCH" = "POST",
) {
	const archived = useProjectReadOnly();
	const lifetime = useActionLifetime();
	const currentTarget = useRef(url);
	currentTarget.current = url;
	const [dirty, setDirty] = useState(false),
		[busy, setBusy] = useState(false),
		[blocked, setBlocked] = useState(false),
		[conflict, setConflict] = useState(false),
		[error, setError] = useState(""),
		[status, setStatus] = useState("");
	const pending = useRef<{
			url: string;
			method: "POST" | "PATCH";
			data: unknown;
			key: string;
			revision?: number;
		} | null>(null),
		running = useRef(false);
	useEffect(() => {
		if (
			pending.current &&
			(pending.current.url !== url || pending.current.method !== method)
		) {
			setBusy(false);
			setBlocked(true);
			setError(
				"操作对象已变化；原操作可能仍完成，请重新载入当前内容后再提交。",
			);
		}
	}, [url, method]);
	useEffect(() => {
		onDirty?.(dirty || busy || blocked);
		return () => onDirty?.(false);
	}, [dirty, busy, blocked, onDirty]);
	useEffect(() => {
		const guard = (e: BeforeUnloadEvent) => {
			if (dirty || busy || blocked) {
				e.preventDefault();
				e.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", guard);
		return () => window.removeEventListener("beforeunload", guard);
	}, [dirty, busy, blocked]);
	async function submit(data: unknown) {
		if (archived) {
			setError("项目已归档，请恢复后再操作。");
			return;
		}
		if (running.current || conflict) return;
		if (
			pending.current &&
			(pending.current.url !== url || pending.current.method !== method)
		)
			return;
		const valid = lifetime.capture();
		const isCurrent = () => valid() && currentTarget.current === url;
		if (!isCurrent()) return;
		running.current = true;
		setBusy(true);
		setError("");
		setStatus("正在提交…");
		const operation = pending.current ?? {
			url,
			method,
			data,
			key: crypto.randomUUID(),
			...(revision !== undefined ? { revision } : {}),
		};
		pending.current = operation;
		try {
			const result = await api<T>(
				operation.url,
				operation.method,
				operation.data,
				{
					key: operation.key,
					...(operation.revision !== undefined
						? { revision: operation.revision }
						: {}),
				},
			);
			if (!isCurrent()) return;
			pending.current = null;
			setBlocked(false);
			setDirty(false);
			setStatus("已保存");
			onDirty?.(false);
			onSuccess(result);
		} catch (e) {
			if (!isCurrent()) return;
			setError(e instanceof Error ? e.message : "操作未完成，请重试。");
			setStatus("提交未完成，输入仍保留");
			if (e instanceof ApiError && e.status === 422) {
				pending.current = null;
				setBlocked(false);
			} else {
				setBlocked(true);
				if (e instanceof ApiError && e.status === 409) setConflict(true);
			}
			if (e instanceof ApiError && e.status === 401) onInvalid();
		} finally {
			if (isCurrent()) setBusy(false);
			running.current = false;
		}
	}
	return {
		dirty,
		busy,
		blocked,
		conflict,
		error,
		setError,
		status,
		submit,
		changed: () => {
			setDirty(true);
			setError("");
		},
		disabled: busy || blocked || archived,
		readOnly: archived,
	};
}
