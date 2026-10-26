import { fileFiltersSchema, type FileFilters } from "@/lib/archive-filters";
import { parseProjectList, projectListHref } from "./project-list-navigation";

export type WorkspaceView = FileFilters & {
	section: "files" | "deliveries";
	fileId: string | null;
	annotationId: string | null;
	issueId: string | null;
	quick: boolean;
};
/** A section switch hides the same sessions; it does not discard their input. */
export function sameWorkspaceContext(a: WorkspaceView, b: WorkspaceView) {
	return (
		a.type === b.type &&
		a.sort === b.sort &&
		a.fileId === b.fileId &&
		a.issueId === b.issueId &&
		(!a.fileId || (a.annotationId === b.annotationId && a.quick === b.quick))
	);
}
const id = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const uuid = (value: string | null) => (value && id.test(value) ? value : null);
export function parseWorkspaceView(params: URLSearchParams): WorkspaceView {
	const type = fileFiltersSchema.shape.type.safeParse(
		params.get("type") ?? "all",
	);
	const sort = fileFiltersSchema.shape.sort.safeParse(
		params.get("sort") ?? "created-desc",
	);
	const fileId = uuid(params.get("file"));
	return {
		section: params.get("section") === "deliveries" ? "deliveries" : "files",
		type: type.success ? type.data : "all",
		sort: sort.success ? sort.data : "created-desc",
		fileId,
		annotationId: fileId ? uuid(params.get("annotation")) : null,
		issueId: fileId ? null : uuid(params.get("issue")),
		quick: !!fileId && params.get("panel") === "annotation",
	};
}
export function safeProjectListReturn(value: string | null) {
	if (!value || !/^\/projects(?:\?[^#\\]*)?$/.test(value)) return "/projects";
	return projectListHref(
		parseProjectList(new URLSearchParams(value.split("?")[1] ?? "")),
	);
}
export function workspaceHref(
	current: URL,
	view: WorkspaceView,
	guest: boolean,
) {
	const params = new URLSearchParams();
	if (guest) {
		const project = uuid(current.searchParams.get("project"));
		if (project) params.set("project", project);
	} else {
		const from = safeProjectListReturn(current.searchParams.get("from"));
		if (from !== "/projects") params.set("from", from);
	}
	params.set("section", view.section);
	if (view.type !== "all") params.set("type", view.type);
	if (view.sort !== "created-desc") params.set("sort", view.sort);
	if (view.fileId) {
		params.set("file", view.fileId);
		if (view.annotationId) params.set("annotation", view.annotationId);
		if (view.quick) params.set("panel", "annotation");
	} else if (view.issueId) params.set("issue", view.issueId);
	return `${current.pathname}?${params}`;
}

export type WorkspaceHistoryMarker = { scope: string; index: number };
export function historyMarker(
	state: unknown,
	scope: string,
): WorkspaceHistoryMarker | null {
	if (!state || typeof state !== "object" || !("pmWorkspace" in state))
		return null;
	const mark = state.pmWorkspace;
	if (
		!mark ||
		typeof mark !== "object" ||
		!("scope" in mark) ||
		!("index" in mark)
	)
		return null;
	return mark.scope === scope &&
		typeof mark.index === "number" &&
		Number.isSafeInteger(mark.index)
		? { scope, index: mark.index }
		: null;
}
