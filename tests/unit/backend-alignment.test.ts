import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
	folderColors,
	folderInput,
	projectFiltersSchema,
} from "../../src/lib/project-folders";
import {
	MiB,
	projectCreateInput,
	projectInput,
	uploadPolicy,
	uploadPolicyDto,
	extensions,
} from "../../src/lib/policy";
import {
	cursorId,
	cursorScope,
	queryCursor,
} from "../../src/lib/server/query-cursor";

const id = "8e6f8d02-b46e-47f8-8cf4-dc7a963ea5b5";
describe("backend alignment contracts", () => {
	it("accepts the frontend's seven colors and trims bounded folder fields", () => {
		for (const color of folderColors)
			expect(folderInput.parse({ name: "  客户 A  ", color }).color).toBe(
				color,
			);
		expect(folderInput.parse({ name: " 分类 " })).toEqual({
			name: "分类",
			description: "",
			color: "blue",
		});
		expect(
			folderInput.safeParse({
				name: "a".repeat(60),
				description: "b".repeat(500),
			}).success,
		).toBe(true);
	});
	it("rejects reserved/empty names, overlong fields, CSS and caller-selected ownership", () => {
		for (const input of [
			{ name: "全部" },
			{ name: "   " },
			{ name: "a".repeat(61) },
			{ name: "A", description: "x".repeat(501) },
			{ name: "A", color: "url(https://bad)" },
			{ name: "A", ownerId: id },
		])
			expect(folderInput.safeParse(input).success).toBe(false);
	});
	it("adds nullable classification only to project creation, keeping PATCH strict", () => {
		expect(
			projectCreateInput.parse({ name: "项目", folderId: id }).folderId,
		).toBe(id);
		expect(projectCreateInput.parse({ name: "旧调用" })).not.toHaveProperty(
			"folderId",
		);
		expect(
			projectCreateInput.parse({ name: "未分类", folderId: null }).folderId,
		).toBeNull();
		expect(projectInput.safeParse({ name: "项目", folderId: id }).success).toBe(
			false,
		);
	});
	it("separates all, unclassified and a specific folder without treating blank as all", () => {
		expect(projectFiltersSchema.parse({})).toEqual({ folderId: null, q: "" });
		expect(
			projectFiltersSchema.parse({ folderId: "none", q: "  中文_%  " }),
		).toEqual({ folderId: "none", q: "中文_%" });
		expect(projectFiltersSchema.safeParse({ folderId: "" }).success).toBe(
			false,
		);
		expect(projectFiltersSchema.safeParse({ q: "x".repeat(201) }).success).toBe(
			false,
		);
	});
	it("binds continuation to owner, folder, term and sorting context", () => {
		const context = ["projects-v1", "owner-A", id, "螺纹", "created-desc"];
		const scope = cursorScope(context),
			cursor = queryCursor(id, scope);
		expect(cursorId(cursor, scope)).toBe(id);
		for (const altered of [
			["projects-v1", "owner-B", id, "螺纹", "created-desc"],
			["projects-v1", "owner-A", null, "螺纹", "created-desc"],
			["projects-v1", "owner-A", id, "孔位", "created-desc"],
		])
			expect(() => cursorId(cursor, cursorScope(altered))).toThrow(
				"CURSOR_INVALID",
			);
	});
	it("rejects malformed, oversized, noncanonical or unscoped cursors", () => {
		const scope = cursorScope(["test"]);
		for (const cursor of [
			"",
			"?",
			"a".repeat(513),
			Buffer.from(JSON.stringify({ v: 2, id, scope })).toString("base64url"),
			`${queryCursor(id, scope)}=`,
		])
			expect(() => cursorId(cursor, scope)).toThrow("CURSOR_INVALID");
		expect(() => cursorId(id, scope)).toThrow();
		expect(cursorId(id, scope, true)).toBe(id);
		expect(cursorId(null, scope)).toBeNull();
	});
	it("binds issue pagination to role/project/file/annotation independently", () => {
		const a = cursorScope([
			"issues-v1",
			"owner:A",
			"P",
			"F",
			"N",
			"priority-created-desc",
		]);
		const b = cursorScope([
			"issues-v1",
			"guest:B",
			"P",
			"F",
			"N",
			"priority-created-desc",
		]);
		expect(() => cursorId(queryCursor(id, a), b)).toThrow("CURSOR_INVALID");
	});
	it("publishes effective per-format limits consistent with actual validation", () => {
		const policy = uploadPolicyDto(50 * MiB);
		expect(policy.maxFileBytes).toBe(50 * MiB);
		expect(policy.formats.map((format) => format.extension)).toEqual([
			...extensions,
		]);
		expect(
			policy.formats.find((format) => format.extension === "png")?.maxFileBytes,
		).toBe(20 * MiB);
		expect(
			policy.formats.find((format) => format.extension === "step")
				?.maxFileBytes,
		).toBe(50 * MiB);
		for (const format of policy.formats)
			expect(() =>
				uploadPolicy(
					`file.${format.extension}`,
					format.maxFileBytes,
					format.declaredMimeTypes?.[0] ?? "",
				),
			).not.toThrow();
		expect(policy.maxBatchFiles).toBe(20);
		expect(policy.processing.required).toBe(true);
	});
	it("reduces every format to a smaller deployment cap without claiming arbitrary MIME safety", () => {
		const policy = uploadPolicyDto(MiB);
		expect(policy.formats.every((format) => format.maxFileBytes === MiB)).toBe(
			true,
		);
		expect(
			policy.formats.find((format) => format.extension === "step")
				?.declaredMimeTypes,
		).toBeNull();
		expect(() => uploadPolicy("file.png", MiB, "application/pdf")).toThrow(
			"MIME_MISMATCH",
		);
	});
});
