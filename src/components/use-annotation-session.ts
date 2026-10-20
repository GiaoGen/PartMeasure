"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type Annotation,
	type AnnotationDocument,
	type AnnotationDraft,
	emptyMetadata,
	sameContent,
	validateAnnotation,
} from "@/lib/annotations";
import { api, ApiError, message } from "./api";
import { useProjectUpdates } from "./project-live";
type Operation = {
	method: string;
	url: string;
	data?: unknown;
	key: string;
	revision?: number;
};
const content = (a: AnnotationDraft) => ({
	geometry: a.geometry,
	metadata: a.metadata,
});
export function useAnnotationSession(
	base: string,
	fileId: string,
	guest: boolean,
	onInvalid: () => void,
	onDirty: (dirty: boolean) => void,
	externalDirty = false,
) {
	const [document, setDocument] = useState<AnnotationDocument | null>(null),
		[items, setItems] = useState<AnnotationDraft[]>([]),
		[heads, setHeads] = useState<Annotation[]>([]);
	const [past, setPast] = useState<AnnotationDraft[][]>([]),
		[future, setFuture] = useState<AnnotationDraft[][]>([]),
		[selected, setSelected] = useState<string | null>(null);
	const [loading, setLoading] = useState(true),
		[status, setStatus] = useState(""),
		[error, setError] = useState(""),
		[saving, setSaving] = useState(false),
		[blocked, setBlocked] = useState(false),
		[conflict, setConflict] = useState(false);
	const itemsRef = useRef(items),
		headsRef = useRef(heads),
		pending = useRef(new Map<string, Operation>()),
		busy = useRef(false),
		editGroup = useRef(""),
		loadRun = useRef(0);
	itemsRef.current = items;
	headsRef.current = heads;
	const invalidRef = useRef(onInvalid);
	invalidRef.current = onInvalid;
	const dirty =
		!guest &&
		(items.some((i) => {
			const h = heads.find((h) => h.id === i.id);
			return !h || h.deleted || !sameContent(content(i), content(h));
		}) ||
			heads.some((h) => !h.deleted && !items.some((i) => i.id === h.id)));
	useEffect(() => {
		onDirty(dirty || saving || blocked);
		return () => onDirty(false);
	}, [dirty, saving, blocked, onDirty]);
	useEffect(() => {
		const prevent = (event: BeforeUnloadEvent) => {
			if (dirty || saving || blocked) {
				event.preventDefault();
				event.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", prevent);
		return () => window.removeEventListener("beforeunload", prevent);
	}, [dirty, saving, blocked]);
	const load = useCallback(async (force = false) => {
		const run = ++loadRun.current;
		if (force) setLoading(true);
		setError("");
		try {
			const data = await api<AnnotationDocument>(
				`${base}/files/${fileId}/annotations`,
			);
			if (run !== loadRun.current) return;
			if (protectedDraft.current && !force) { setStatus("远程更新未覆盖当前草稿"); return; }
			setDocument(data);
			setHeads(data.items);
			headsRef.current = data.items;
			setItems(data.items.filter((i) => !i.deleted));
			setPast([]);
			setFuture([]);
			setSelected(previous => !force && data.items.some(i => i.id === previous && !i.deleted) ? previous : null);
			pending.current.clear();
			setBlocked(false);
			setConflict(false);
			setStatus("已载入已保存的标注");
		} catch (e) {
			if (run !== loadRun.current) return;
			if (e instanceof ApiError && e.status === 401) invalidRef.current();
			setError(e instanceof Error ? e.message : "无法载入标注，请重试。");
		} finally {
			if (run === loadRun.current) setLoading(false);
		}
	}, [base, fileId]);
	useEffect(() => {
		void load();
		return () => {
			loadRun.current++;
		};
	}, [load]);
 const protectedDraft = useRef(false); protectedDraft.current = dirty || saving || blocked || externalDirty;
 useProjectUpdates(updates => {
  if (!updates.some(e => e.kind === "resync" || ((e.kind === "annotation.changed" || e.kind === "issue.changed") && e.fileId === fileId))) return;
  if (protectedDraft.current) setStatus("标注已有远程更新；当前草稿已保留，保存时检查修订冲突。");
  else void load();
 });

	const change = (next: AnnotationDraft[], group = "") => {
		if (guest || saving || blocked) return;
		const previous = itemsRef.current;
		if (!group || editGroup.current !== group)
			setPast((old) => [...old.slice(-99), previous]);
		editGroup.current = group;
		setFuture([]);
		setItems(next);
		itemsRef.current = next;
		setStatus("有未保存的修改");
	};
	const update = (item: AnnotationDraft, group = "") => {
		if (!document) return;
		try {
			validateAnnotation(
				item.geometry.type === "text"
					? { ...item.geometry, text: item.geometry.text || "备注" }
					: item.geometry,
				emptyMetadata(),
				document.image.width,
				document.image.height,
			);
			setError("");
			change(
				itemsRef.current.map((i) => (i.id === item.id ? item : i)),
				group,
			);
		} catch (e) {
			setError(message(e instanceof Error ? e.message : "INVALID_GEOMETRY"));
		}
	};
	function undo() {
		if (!past.length || guest || saving || blocked) return;
		const next = past.at(-1) as AnnotationDraft[],
			previous = itemsRef.current;
		setPast((p) => p.slice(0, -1));
		setFuture((f) => [previous, ...f].slice(0, 100));
		setItems(next);
		itemsRef.current = next;
		editGroup.current = "";
		setStatus("已撤销；保存后同步");
	}
	function redo() {
		if (!future.length || guest || saving || blocked) return;
		const next = future[0] as AnnotationDraft[],
			previous = itemsRef.current;
		setFuture((f) => f.slice(1));
		setPast((p) => [...p.slice(-99), previous]);
		setItems(next);
		itemsRef.current = next;
		editGroup.current = "";
		setStatus("已重做；保存后同步");
	}
	async function save() {
		if (guest || !document || busy.current || conflict) return;
		try {
			for (const item of itemsRef.current)
				validateAnnotation(
					item.geometry,
					item.metadata,
					document.image.width,
					document.image.height,
				);
		} catch (e) {
			setError(
				message(e instanceof Error ? e.message : "INVALID_ENGINEERING_FIELDS"),
			);
			setStatus("请检查工程字段后再保存");
			return;
		}
		busy.current = true;
		setSaving(true);
		setError("");
		setStatus("正在保存…");
		editGroup.current = "";
		const snapshot = itemsRef.current;
		const ids = [
			...new Set([
				...snapshot.map((i) => i.id),
				...headsRef.current.filter((h) => !h.deleted).map((h) => h.id),
			]),
		];
		try {
			for (const id of ids) {
				const wanted = snapshot.find((i) => i.id === id),
					head = headsRef.current.find((h) => h.id === id);
				if (
					wanted &&
					head &&
					!head.deleted &&
					sameContent(content(wanted), content(head))
				)
					continue;
				if (!wanted && (!head || head.deleted)) continue;
				let operation = pending.current.get(id);
				if (!operation) {
					if (wanted)
						validateAnnotation(
							wanted.geometry,
							wanted.metadata,
							document.image.width,
							document.image.height,
						);
					operation = wanted
						? head
							? {
									method: "PATCH",
									url: `${base}/annotations/${id}`,
									data: {
										...content(wanted),
										imageHash: document.image.imageHash,
									},
									revision: head.revision,
									key: crypto.randomUUID(),
								}
							: {
									method: "POST",
									url: `${base}/annotations`,
									data: {
										id,
										fileId,
										...content(wanted),
										imageHash: document.image.imageHash,
									},
									key: crypto.randomUUID(),
								}
						: {
								method: "DELETE",
								url: `${base}/annotations/${id}`,
								revision: head?.revision ?? 0,
								key: crypto.randomUUID(),
							};
					pending.current.set(id, operation);
				}
				const result = await api<Annotation>(
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
				headsRef.current = [
					...headsRef.current.filter((h) => h.id !== id),
					result,
				];
				setHeads(headsRef.current);
				pending.current.delete(id);
			}
			setBlocked(false);
			setStatus("已保存");
			return headsRef.current;
		} catch (e) {
			setBlocked(true);
			setStatus("保存未完成，草稿仍保留在本页");
			setError(
				e instanceof ApiError
					? e.message
					: message(e instanceof Error ? e.message : "DEPENDENCY_UNAVAILABLE"),
			);
			if (e instanceof ApiError && e.status === 422) {
				setBlocked(false);
				pending.current.clear();
			}
			if (e instanceof ApiError && e.status === 409) setConflict(true);
			if (e instanceof ApiError && e.status === 401) invalidRef.current();
		} finally {
			busy.current = false;
			setSaving(false);
		}
	}
	return {
		document,
		items,
		heads,
		selected,
		setSelected,
		loading,
		status,
		error,
		setError,
		saving,
		blocked,
		conflict,
		dirty,
		load,
		change,
		update,
		undo,
		redo,
		save,
		canUndo: past.length > 0,
		canRedo: future.length > 0,
		endEdit: () => {
			editGroup.current = "";
		},
	};
}
