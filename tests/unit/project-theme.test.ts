import { describe, expect, it } from "vitest";
import {
	folderColors,
	parseFolderColor,
	projectWorkspaceHref,
	workspaceThemeStyle,
} from "../../src/components/projects-theme";

describe("cosmetic workspace theme", () => {
	it("accepts only the seven own color keys", () => {
		for (const color of Object.keys(folderColors))
			expect(parseFolderColor(color)).toBe(color);
		for (const value of [
			null,
			"",
			"toString",
			"__proto__",
			"red",
			"url(x)",
			"#ffffff",
		])
			expect(parseFolderColor(value)).toBeUndefined();
	});
	it("carries only a fixed color hint and escapes the project path", () => {
		expect(projectWorkspaceHref("project", "rose")).toBe(
			"/projects/project?theme=rose",
		);
		expect(projectWorkspaceHref("a/b?x=y")).toBe("/projects/a%2Fb%3Fx%3Dy");
	});
	it("uses every folder's page and panel palette, with a neutral default", () => {
		for (const color of Object.keys(folderColors)) {
			const key = parseFolderColor(color);
			if (!key) throw new Error("Missing fixed folder palette");
			expect(workspaceThemeStyle(key)).toMatchObject({
				"--workspace-page": folderColors[key].page,
				"--workspace-panel": folderColors[key].folder,
			});
		}
		expect(workspaceThemeStyle()).toMatchObject({
			"--workspace-page": "#f7f9fc",
		});
	});
});
