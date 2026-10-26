import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "../../src/app/page";
import { AuthForm } from "../../src/components/auth-form";
import { Projects } from "../../src/components/projects";

describe("migrated entry server rendering", () => {
	it("renders a labelled illustration and genuine entry links without remote image calls", () => {
		const html = renderToStaticMarkup(createElement(Home));
		expect(html).toContain('data-appearance="system"');
		expect(html).toContain('href="/projects"');
		expect(html).toContain('href="/login"');
		expect(html).toContain("产品流程示意");
		expect(html).toContain("示例数据");
		expect(html).not.toContain("<img");
	});
	it("keeps real password login and client registration guidance", () => {
		const html = renderToStaticMarkup(createElement(AuthForm));
		expect(html).toContain('type="password"');
		expect(html).toContain('autoComplete="current-password"');
		expect(html).toContain("显示密码");
		expect(html).toContain("没有账号？注册");
		expect(html).toContain("客户无需注册");
	});
	it("keeps archived projects downloadable via the workspace and their restore action accessible", () => {
		const html = renderToStaticMarkup(
			createElement(Projects, {
				initial: [
					{
						id: "00000000-0000-4000-8000-000000000001",
						name: "支座 <script>alert(1)</script>",
						description: "",
						revision: 1,
						createdAt: "2026-10-25T00:00:00Z",
						archivedAt: "2026-10-25T01:00:00Z",
					},
				],
				initialCursor: null,
				initialError: "",
				initialFolders: [],
				initialFolderError: "",
				initialFilters: { folderId: "", q: "", status: "archived" },
				initialCount: 1,
			}),
		);
		expect(html).toContain("恢复项目");
		expect(html).toContain("已归档");
		expect(html).toContain(
			'href="/projects/00000000-0000-4000-8000-000000000001?from=%2Fprojects%3Fstatus%3Darchived"',
		);
		expect(html).toContain("&lt;script&gt;");
		expect(html).not.toContain("<script>alert");
	});
	it("does not present a failed database read as a legitimate empty project list", () => {
		const html = renderToStaticMarkup(
			createElement(Projects, {
				initial: [],
				initialCursor: null,
				initialError: "数据库暂时不可用",
				initialFolders: [],
				initialFolderError: "",
			}),
		);
		expect(html).toContain('role="alert"');
		expect(html).toContain("重新加载");
		expect(html).not.toContain("开始你的第一个项目");
	});
});
