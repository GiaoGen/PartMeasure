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
import { api, ApiError, message, readCached } from "./api";
import { prioritizeLayers, readInteractionDocument } from "./interaction-reads";
import { useApiRevalidation } from "./use-api-revalidation";
import { useProjectUpdates } from "./project-live";
import { cvDraftUpdate, type CvDraftTicket } from "@/lib/cv/draft";
import { useProjectReadOnly } from "./project-read-only";
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
	initialAnnotationId?: string,
) {
	const archived = useProjectReadOnly();
	const url = `${base}/files/${fileId}/annotations`;
	const [document, setDocument] = useState<AnnotationDocument | null>(() => readCached<AnnotationDocument>(url) ?? null),
		[items, setItems] = useState<AnnotationDraft[]>(() => document?.items.filter(i => !i.deleted) ?? []),
		[heads, setHeads] = useState<Annotation[]>(() => document?.items ?? []);
	const [past, setPast] = useState<AnnotationDraft[][]>([]),
		[future, setFuture] = useState<AnnotationDraft[][]>([]),
		[selected, setSelected] = useState<string | null>(null);
	const [loading, setLoading] = useState(!document),
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
	const reading = useRef<AbortController | null>(null);
	const activeRead = useRef(false);
	const draftVersion = useRef(0);
	const selectedRef = useRef(selected);
	selectedRef.current = selected;
	const selectDraft = useCallback((id: string | null) => {
		if (selectedRef.current !== id) { draftVersion.current++; selectedRef.current = id; }
		setSelected(id);
	}, []);
	itemsRef.current = items;
	headsRef.current = heads;
	const documentRef = useRef(document);
	documentRef.current = document;
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
		if (!force && activeRead.current && !reading.current?.signal.aborted) return;
		activeRead.current = true;
		const run = ++loadRun.current;
		reading.current?.abort();
		const controller = new AbortController();
		reading.current = controller;
		setError("");
		try {
			prioritizeLayers(base, fileId);
			const data = initialAnnotationId && !readCached<AnnotationDocument>(url)
				? await readInteractionDocument(base, fileId, initialAnnotationId, { refresh: force, signal: controller.signal })
				: await api<AnnotationDocument>(
				url, "GET", undefined, { refresh: force, signal: controller.signal },
			);
			if (run !== loadRun.current) return;
			if (controller.signal.aborted) return;
			if (protectedDraft.current && !force) { setStatus("远程更新未覆盖当前草稿"); return; }
			if (!force && JSON.stringify(documentRef.current) === JSON.stringify(data)) return;
			setDocument(data);
			draftVersion.current++;
			setHeads(data.items);
			headsRef.current = data.items;
			setItems(data.items.filter((i) => !i.deleted));
			setPast([]);
			setFuture([]);
			editGroup.current = "";
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
			if (run === loadRun.current) { activeRead.current = false; setLoading(false); }
		}
	}, [url, base, fileId, initialAnnotationId]);
	useEffect(() => {
		void load();
		return () => {
			loadRun.current++;
			reading.current?.abort();
		};
	}, [load]);
 const protectedDraft = useRef(false); protectedDraft.current = dirty || saving || blocked || externalDirty;
 useApiRevalidation(() => { if (!protectedDraft.current) void load(); });
 useProjectUpdates(updates => {
  if (!updates.some(e => e.kind === "resync" || ((e.kind === "annotation.changed" || e.kind === "issue.changed") && e.fileId === fileId))) return;
  if (protectedDraft.current) setStatus("标注已有远程更新；当前草稿已保留，保存时检查修订冲突。");
  else void load();
 });

	const change = (next: AnnotationDraft[], group = "") => {
		if (guest || archived || saving || blocked) return;
		const previous = itemsRef.current;
		if (sameContent(previous, next)) return;
		draftVersion.current++;
		// Protect edits immediately, before React renders the updated dirty flag.
		protectedDraft.current = true;
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
		if (!past.length || guest || archived || saving || blocked) return;
		draftVersion.current++;
		const next = past.at(-1) as AnnotationDraft[],
			previous = itemsRef.current;
		setPast((p) => p.slice(0, -1));
		setFuture((f) => [previous, ...f].slice(0, 100));
		setItems(next);
		itemsRef.current = next;
		setSelected(id => next.some(item => item.id === id) ? id : null);
		protectedDraft.current = true;
		editGroup.current = "";
		setStatus("已撤销；保存后同步");
	}
	function redo() {
		if (!future.length || guest || archived || saving || blocked) return;
		draftVersion.current++;
		const next = future[0] as AnnotationDraft[],
			previous = itemsRef.current;
		setFuture((f) => f.slice(1));
		setPast((p) => [...p.slice(-99), previous]);
		setItems(next);
		itemsRef.current = next;
		setSelected(id => next.some(item => item.id === id) ? id : null);
		protectedDraft.current = true;
		editGroup.current = "";
		setStatus("已重做；保存后同步");
	}
	async function save() {
		if (guest || archived || !document || busy.current || conflict) return;
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
		draftVersion.current++;
		protectedDraft.current = true;
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
		setSelected: selectDraft,
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
		captureCvTicket: (id: string): CvDraftTicket | undefined => {
			const current = itemsRef.current.find(i => i.id === id), image = documentRef.current?.image;
			if (guest || archived || busy.current || blocked || !current || !image || headsRef.current.some(h => h.id === id)) return;
			return { id, imageId: image.id, imageHash: image.imageHash, version: draftVersion.current, geometry: structuredClone(current.geometry) };
		},
		applyCvFit: (ticket: CvDraftTicket, geometry: AnnotationDraft["geometry"]) => {
			const image = documentRef.current?.image;
			if (!image) return false;
			const item = cvDraftUpdate(ticket, geometry, { image, current: itemsRef.current.find(i => i.id === ticket.id), selected: selectedRef.current, version: draftVersion.current, saved: headsRef.current.some(h => h.id === ticket.id), editable: !guest && !archived && !busy.current && !saving && !blocked && !externalDirty });
			if (!item) return false;
			// Separate undo step restores the original hand drawing, with all human
			// fields intact. Never group this into creation or a subsequent drag.
			change(itemsRef.current.map(i => i.id === item.id ? item : i));
			return true;
		},
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
