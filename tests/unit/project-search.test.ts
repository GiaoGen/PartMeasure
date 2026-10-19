import { describe, expect, it } from "vitest";
import { searchProjects } from "../../src/components/project-search";

const projects = [
	{ id: "plate", name: "安装板测绘", description: "确认孔距与板厚" },
	{ id: "sleeve", name: "轴套尺寸复核", description: "补充内径和 STEP 资料" },
	{ id: "empty", name: "支架", description: "" },
];

describe("project name and description search", () => {
	it("matches a partial Chinese project name", () => {
		expect(
			searchProjects(projects, "轴套").map((project) => project.id),
		).toEqual(["sleeve"]);
	});
	it("matches description text independently of the name", () => {
		expect(
			searchProjects(projects, "孔距").map((project) => project.id),
		).toEqual(["plate"]);
	});
	it("ignores case and surrounding whitespace", () => {
		expect(
			searchProjects(projects, "  step  ").map((project) => project.id),
		).toEqual(["sleeve"]);
	});
	it("restores the provided category when the query is cleared", () => {
		expect(searchProjects(projects.slice(0, 1), "  ")).toEqual([projects[0]]);
	});
	it("does not introduce projects from outside the provided category", () => {
		expect(searchProjects(projects.slice(0, 1), "轴套")).toEqual([]);
	});
	it("handles descriptions without content and returns no false matches", () => {
		expect(searchProjects(projects, "不存在")).toEqual([]);
		expect(
			searchProjects(projects, "支架").map((project) => project.id),
		).toEqual(["empty"]);
	});
});
