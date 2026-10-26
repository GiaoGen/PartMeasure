import { projectFiltersSchema } from "@/lib/project-folders";

export type ProjectListState = {
	folderId: string;
	q: string;
	status: "active" | "archived" | "all";
};
export const defaultProjectList: ProjectListState = {
	folderId: "",
	q: "",
	status: "active",
};
export function parseProjectList(params: URLSearchParams): ProjectListState {
	const folder = projectFiltersSchema.shape.folderId.safeParse(
		params.get("folderId") || null,
	);
	const status = projectFiltersSchema.shape.status.safeParse(
		params.get("status") ?? "active",
	);
	return {
		folderId: folder.success ? (folder.data ?? "") : "",
		status: status.success ? status.data : "active",
		q: (params.get("q") ?? "").trim().slice(0, 200),
	};
}
export function projectListHref(state: ProjectListState): string {
	const params = new URLSearchParams();
	if (state.folderId) params.set("folderId", state.folderId);
	if (state.status !== "active") params.set("status", state.status);
	if (state.q.trim()) params.set("q", state.q.trim());
	return `/projects${params.size ? `?${params}` : ""}`;
}

/** Only a scroll coordinate lives in this history entry; no project records are persisted. */
export function rememberProjectListScroll() {
	window.history.replaceState(
		{ ...window.history.state, pmListScroll: window.scrollY },
		"",
		window.location.href,
	);
}
