// Browser-only intercepted fixture document; no additional HTTP service or mock Auth endpoints.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import sharp from "sharp";
import { chromium, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 35000 });
const bytes = await readFile("tmp/p0-4/manual-sample.png");
const metadata = await sharp(bytes).metadata();
const built = await build({ entryPoints: ["scripts/fix-b/browser-fixture.tsx"], bundle: true, format: "iife", platform: "browser", write: false, outfile: "tmp/fix-b/fixture.js", define: { "process.env.NODE_ENV": '"production"' }, jsx: "automatic" });
const js = built.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = built.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
const root = "http://127.0.0.1:3000", results = [], run = Date.now();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
await context.addInitScript(() => Object.defineProperty(window, "navigation", { value: undefined, configurable: true }));
let unauthorizedRequests = 0;
await context.route("**/*", route => {
	const url = new URL(route.request().url());
	if (url.pathname === "/fix-b-fixture") return route.fulfill({ contentType: "text/html", body: `<html lang="zh-CN"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.fixtureImage=${JSON.stringify({ width: metadata.width, height: metadata.height, imageHash: createHash("sha256").update(bytes).digest("hex"), src: `data:image/png;base64,${bytes.toString("base64")}` })}</script><script src="/fix-b-fixture.js"></script></body></html>` });
	if (url.pathname === "/fix-b-fixture.js") return route.fulfill({ contentType: "text/javascript", body: js });
	if (url.origin === root && ["/cv/", "/measurement-help/", "/fonts/"].some(prefix => url.pathname.startsWith(prefix)) && route.request().method() === "GET") return route.continue();
	if (url.origin === root && url.pathname === "/favicon.ico") return route.fulfill({ status: 204 });
	unauthorizedRequests++; return route.abort("blockedbyclient");
});
const page = await context.newPage(); page.setDefaultTimeout(35000);
page.on("dialog", dialog => dialog.dismiss());
async function check(name, work) {
	const start = performance.now();
	try { await work(); results.push({ name, status: "PASS", milliseconds: Math.round(performance.now() - start) }); }
	catch (error) { results.push({ name, status: "NOT_PASSED", milliseconds: Math.round(performance.now() - start), assertionLine: Number(String(error.stack ?? "").match(/local-browser-check\.mjs:(\d+)/)?.[1]) || null }); process.exitCode = 1; }
	console.log(JSON.stringify(results.at(-1)));
}
try {
	await page.goto(`${root}/fix-b-fixture`, { waitUntil: "load" });
	await expect(page.getByRole("button", { name: "检测组件样本", exact: true })).toBeEnabled();
	await check("real_browser_legacy_feature_path_cancels_both_directions_without_truncating_forward", async () => {
		await page.getByLabel("未提交输入").fill("local fixture retained");
		await page.getByRole("button", { name: "准备同文档历史" }).click();
		await expect.poll(() => page.evaluate(() => location.pathname)).toBe("/fix-b-workspace");
		const initial = await page.evaluate(() => ({ href: location.href, length: history.length, position: history.state.pmHistory.position }));
		for (const delta of [-1, 1]) {
			await page.evaluate(delta => history.go(delta), delta);
			await expect.poll(() => page.evaluate(() => location.href)).toBe(initial.href);
			assert.equal(await page.evaluate(() => history.length), initial.length);
			assert.equal(await page.evaluate(() => history.state.pmHistory.position), initial.position);
		}
		await expect(page.getByLabel("未提交输入")).toHaveValue("local fixture retained");
	});
	await check("help_open_close_and_reduced_motion_modal_keep_input_and_unlock", async () => {
		await page.locator(".measurement-help > summary").click();
		await page.getByText("游标卡尺怎么读", { exact: true }).click();
		await expect(page.locator('.measurement-help-reading img')).toBeVisible();
		await expect.poll(() => page.locator('.measurement-help-reading img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
		await expect(page.getByLabel("未提交输入")).toHaveValue("local fixture retained");
		const trigger = page.getByRole("button", { name: "打开弹框", exact: true });
		await trigger.click(); await page.getByRole("button", { name: "关闭并立即重开", exact: true }).click();
		await expect(page.locator("dialog")).toBeVisible();
		assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
		await page.getByRole("button", { name: "关闭弹框", exact: true }).click();
		await expect(page.locator("dialog")).not.toBeVisible();
		assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden");
		await expect(trigger).toBeFocused();
	});
	await check("actual_cv_hook_worker_first_load_cancel_retry_local_pixels", async () => {
		await page.getByRole("button", { name: "检测组件样本", exact: true }).click();
		await page.getByRole("button", { name: "取消组件辅助", exact: true }).click();
		await expect(page.locator("#cv-status")).toContainText("已取消");
		await page.getByRole("button", { name: "检测组件样本", exact: true }).click();
		await expect(page.locator("#cv-busy")).toHaveText("false");
		await expect(page.locator("#cv-status")).not.toContainText("辅助暂不可用");
		await expect(page.locator("#cv-status")).toContainText(/候选/);
	});
} finally {
	await mkdir("docs/evidence/fix-b", { recursive: true });
	await writeFile(`docs/evidence/fix-b/local-browser-${run}.json`, `${JSON.stringify({ checkedAt: new Date().toISOString(), browser: browser.version(), scope: "Isolated component fixture only: actual ApplicationHistory/WorkspaceHistory, MeasurementHelp, useProjectDialog and useCvAssistance plus generated CV Worker/runtime. Current Chrome with Navigation API masked. Local synthetic pixels; no Auth/API or real mobile/soft keyboard/old Safari acceptance, no new HTTP service.", unauthorizedRequests, results }, null, 2)}\n`);
	await context.close(); await browser.close();
}
