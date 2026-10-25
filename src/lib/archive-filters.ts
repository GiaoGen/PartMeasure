import { z } from "zod";
export const projectStatuses = { active: "进行中", archived: "已归档", all: "全部" } as const;
export const fileTypes = { all: "全部资料", image: "图片", pdf: "PDF", cad: "CAD", zip: "ZIP" } as const;
export const fileSorts = { "created-desc": "最新上传", "created-asc": "最早上传", "name-asc": "文件名" } as const;
export const fileFiltersSchema = z.object({
	type: z.enum(["all", "image", "pdf", "cad", "zip"]).default("all"),
	sort: z.enum(["created-desc", "created-asc", "name-asc"]).default("created-desc"),
}).strict();
export type FileFilters = z.infer<typeof fileFiltersSchema>;
export const archiveInputSchema = z.object({ archived: z.boolean() }).strict();
export const defaultFileFilters: FileFilters = { type: "all", sort: "created-desc" };
export function filesUrl(base: string, filters: FileFilters, cursor: string | null = null) {
	const query = new URLSearchParams({ type: filters.type, sort: filters.sort });
	if (cursor) query.set("cursor", cursor);
	return `${base}/files?${query}`;
}
