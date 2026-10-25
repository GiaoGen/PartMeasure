import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { archiveInputSchema, fileFiltersSchema, filesUrl } from "../../src/lib/archive-filters";
import { projectFiltersSchema } from "../../src/lib/project-folders";
import { cursorId, cursorScope, queryCursor } from "../../src/lib/server/query-cursor";
import { eventTags, mutationTags } from "../../src/components/cache-policy";
describe("archive and filter contracts", () => {
	it("keeps status separate from ownership and only accepts explicit archive actions", () => {
		expect(projectFiltersSchema.parse({}).status).toBe("active");
		for (const status of ["active", "archived", "all"]) expect(projectFiltersSchema.safeParse({ status }).success).toBe(true);
		expect(projectFiltersSchema.safeParse({ status: "deleted" }).success).toBe(false);
		expect(archiveInputSchema.safeParse({ archived: true }).success).toBe(true);
		for (const value of [{ archived: "false" }, { archived: true, ownerId: "forged" }, { archivedAt: "today" }]) expect(archiveInputSchema.safeParse(value).success).toBe(false);
	});
	it("bounds types and sorting, and uses the same scope for all pages", () => {
		expect(fileFiltersSchema.parse({})).toEqual({ type: "all", sort: "created-desc" });
		expect(fileFiltersSchema.safeParse({ sort: "filename;delete" }).success).toBe(false);
		expect(fileFiltersSchema.safeParse({ type: "private" }).success).toBe(false);
		expect(filesUrl("/api/projects/P", { type: "cad", sort: "name-asc" }, "older")).toBe("/api/projects/P/files?type=cad&sort=name-asc&cursor=older");
		const id = "00000000-0000-4000-8000-000000000001";
		const scope = cursorScope(["files-v2", "guest:G", "P", "material", "cad", "name-asc"]);
		const cursor = queryCursor(id, scope);
		expect(cursorId(cursor, scope)).toBe(id);
		expect(() => cursorId(cursor, cursorScope(["files-v2", "guest:G", "P", "material", "cad", "created-desc"]))).toThrow("CURSOR_INVALID");
	});
	it("invalidates the project working set on archive events without touching another project", () => {
		const tags = eventTags("/api/projects/P", [{ kind: "project.changed", sequence: "1", entityId: "P", fileId: null, revision: 2, state: "archived" }]);
		expect(tags).toContain("/api/projects/P"); expect(tags).toContain("projects:list"); expect(tags).not.toContain("/api/projects/Q");
		expect(mutationTags("/api/projects/P/archive")).toEqual(["/api/projects/P", "projects:list"]);
	});
});
