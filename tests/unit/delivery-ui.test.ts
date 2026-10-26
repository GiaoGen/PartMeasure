import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Delivery } from "../../src/lib/deliveries";
import { DeliveryContents } from "../../src/components/delivery-version";
import { DeliveryHistory } from "../../src/components/delivery-history";
import { ProductSurface } from "../../src/components/product-surface";
import { ProjectReadOnly } from "../../src/components/project-read-only";
import { WorkspaceStatus } from "../../src/components/workspace-status";
import { ProjectEntryLoading } from "../../src/components/project-entry-loading";

const delivery: Delivery = {
	id: "00000000-0000-4000-8000-000000000001",
	state: "published",
	revision: 2,
	versionNo: 3,
	createdAt: "2026-10-25T00:00:00Z",
	publishedAt: "2026-10-25T01:00:00Z",
	description: "调整支座 <script>alert(1)</script>",
	files: [
		{
			id: "00000000-0000-4000-8000-000000000002",
			filename: "支座<script>.step",
			mime: "application/octet-stream",
			byteSize: "1024",
		},
	],
};
const noop = () => {};
function render(children: ReactNode, archived = false) {
	return renderToStaticMarkup(
		createElement(
			ProductSurface,
			null,
			createElement(ProjectReadOnly.Provider, { value: archived }, children),
		),
	);
}
function contents(guest: boolean) {
	return createElement(DeliveryContents, {
		delivery,
		base: guest ? "/api/guest/projects/project" : "/api/projects/project",
		guest,
		visible: true,
		onInvalid: noop,
		onFeedbackDirty: noop,
	});
}
describe("delivery UI role and retained capability boundaries", () => {
	it("binds Guest feedback to the displayed version and escapes file names and version text", () => {
		const html = render(contents(true));
		expect(html).toContain("对 V003 的客户反馈");
		expect(html).toContain("接受本版");
		expect(html).toContain("已收到");
		expect(html).toContain("ZIP打包附件");
		expect(html).toContain("下载 支座&lt;script&gt;.step");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("确认发布成果");
	});
	it("keeps Owner feedback read-only without removing attachment download and ZIP entry", () => {
		const html = render(contents(false));
		expect(html).toContain("客户反馈与接收");
		expect(html).toContain("ZIP打包附件");
		expect(html).toContain("下载 支座");
		expect(html).not.toContain("<textarea");
		expect(html).not.toContain("提交留言");
	});
	it("keeps archived Guest downloads accessible while disabling the whole write fieldset", () => {
		const html = render(contents(true), true);
		expect(html).toContain('<fieldset disabled="">');
		expect(html).toContain("接受本版");
		expect(html).toContain("ZIP打包附件");
		expect(html).toContain("下载 支座");
	});
	it("starts history collapsed without rendering private drafts or an unrequested version detail", () => {
		const html = render(
			createElement(DeliveryHistory, {
				base: "/api/guest/projects/project",
				beforeVersion: 3,
				visible: true,
				guest: true,
				onInvalid: noop,
				onFeedbackDirty: noop,
				allowFeedbackLeave: async () => true,
			}),
		);
		expect(html).toContain('aria-expanded="false"');
		expect(html).toContain("每页10个版本");
		expect(html).not.toContain("读取本版本附件");
		expect(html).not.toContain("私有草稿");
	});
});
describe("route status context", () => {
	it("does not send Guest error/loading screens to Owner routes", () => {
		const html = renderToStaticMarkup(
			createElement(WorkspaceStatus, {
				guest: true,
				title: "共享项目暂时无法加载",
				message: "请联系工程师。",
				retryable: true,
			}),
		);
		expect(html).toContain("资料与补测");
		expect(html).toContain("重新加载");
		expect(html).not.toContain('href="/projects"');
		expect(html).not.toContain("项目设置");
	});
	it("keeps project list failure distinct from a legitimate empty list", () => {
		const html = renderToStaticMarkup(
			createElement(ProjectEntryLoading, { error: "认证暂时不可用" }),
		);
		expect(html).toContain('aria-busy="false"');
		expect(html).toContain('role="alert"');
		expect(html).toContain("重新加载");
		expect(html).not.toContain("开始你的第一个项目");
	});
});
