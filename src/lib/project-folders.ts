import { z } from "zod";

export const folderColors = [
	"blue",
	"cyan",
	"green",
	"purple",
	"rose",
	"coral",
	"slate",
] as const;
export const folderLimit = 200;
export const folderInput = z
	.object({
		name: z
			.string()
			.trim()
			.min(1)
			.max(60)
			.refine((value) => value !== "全部"),
		description: z.string().trim().max(500).default(""),
		color: z.enum(folderColors).default("blue"),
	})
	.strict();
export type FolderInput = z.infer<typeof folderInput>;
export type ProjectFolder = FolderInput & {
	id: string;
	revision: number;
	createdAt: string;
	updatedAt: string;
	projectCount: number;
};
export type FolderSummary = Pick<ProjectFolder, "id" | "name" | "color">;
export const projectFiltersSchema = z
	.object({
		q: z.string().trim().max(200).default(""),
		folderId: z
			.union([z.uuid(), z.literal("none")])
			.nullable()
			.default(null),
		status: z.enum(["active", "archived", "all"]).default("active"),
	})
	.strict();
export type ProjectFilters = Omit<z.infer<typeof projectFiltersSchema>, "status"> & { status?: "active" | "archived" | "all" };
