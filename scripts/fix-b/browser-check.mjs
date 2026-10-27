// Explicitly authorized local browser checks. No business saves/uploads/Guest bootstrap/mail.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium, expect as baseExpect } from "@playwright/test";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const root = "http://127.0.0.1:3000";
const expect = baseExpect.configure({ timeout: 45000 });
if (process.env.APP_URL !== root || new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "rvysclscetfqicpnzlra.supabase.co") throw Error("ISOLATED_LOOPBACK_ONLY");
const account = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8")).A;
const fixture = JSON.parse(await readFile("tmp/p0-4/fixture.json", "utf8"));
const run = Date.now(), results = [], blockedWrites = [], errors = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await context.route("**/*", route => {
	const request = route.request(), url = new URL(request.url());
	if (url.origin === root && url.pathname.startsWith("/api/") && !["GET", "HEAD"].includes(request.method()) && url.pathname !== "/api/auth/login") {
		blockedWrites.push({ method: request.method(), category: "UNAUTHORIZED_BUSINESS_WRITE_BLOCKED" });
		return route.abort("blockedbyclient");
	}
	return route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(45000);
let setupStage = "open_login", setupError = null;
const authResponses = [];
page.on("response", response => { if (new URL(response.url()).pathname === "/api/auth/login") authResponses.push(response.status()); });
const consoleErrors = [];
page.on("console", event => { if (event.type() === "error") consoleErrors.push({ kind: /content security policy/i.test(event.text()) ? "CSP" : "CONSOLE_ERROR" }); });
page.on("pageerror", () => errors.push({ kind: "pageerror" }));
let acceptDialog = false, confirms = 0;
page.on("dialog", dialog => { confirms++; return acceptDialog ? dialog.accept() : dialog.dismiss(); });
let photo;
async function check(name, work) {
	if (process.env.PM_FIXB_FOCUS && !process.env.PM_FIXB_FOCUS.split(",").includes(name)) return;
	console.log(JSON.stringify({ event: "browser_stage", name }));
	const started = performance.now();
	try { await work(); results.push({ name, status: "PASS", milliseconds: Math.round(performance.now() - started) }); }
	catch (error) {
		const line = String(error.stack ?? "").match(/browser-check\.mjs:(\d+):\d+/)?.[1];
		results.push({ name, status: "NOT_PASSED", code: "BROWSER_ASSERTION_FAILED", assertionLine: line ? Number(line) : null, milliseconds: Math.round(performance.now() - started) });
		await page.screenshot({ path: `tmp/fix-b/failure-${name}-${run}.png`, fullPage: false }).catch(() => {});
		process.exitCode = 1;
	}
	console.log(JSON.stringify(results.at(-1)));
}
async function photoPage(search = "") {
	acceptDialog = true;
	await page.goto(`${root}/projects/${fixture.projectA}?section=files&file=${fixture.material.id}${search}`, { waitUntil: "domcontentloaded" });
	acceptDialog = false;
	await expect(page.locator(".detail-heading h2")).toHaveText(photo.filename);
	await expect(page.getByRole("button", { name: "线段", exact: true })).toBeEnabled();
	await expect(page.getByRole("button", { name: "识别圆／椭圆", exact: true })).toBeEnabled();
}
async function drawLine() {
	await page.getByRole("button", { name: "线段", exact: true }).click();
	const box = await page.locator(".annotation-viewport").boundingBox(); assert.ok(box);
	await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.45, { steps: 4 });
	await page.mouse.up();
	await expect(page.getByLabel("名称", { exact: true })).toBeVisible();
}
try {
	await mkdir("tmp/fix-b", { recursive: true });
	// Use the normal CSRF/password API with the browser context's real cookie jar.
	// Login-page hydration is outside this package; credentials never enter URL/native GET submission.
	setupStage = "normal_password_api";
	const csrf = (await (await context.request.get(`${root}/api/csrf`)).json()).data.token;
	const login = await context.request.post(`${root}/api/auth/login`, { headers: { origin: root, "x-csrf-token": csrf }, data: account });
	authResponses.push(login.status()); assert.equal(login.status(), 200);
	setupStage = "open_projects";
	await page.goto(`${root}/projects`, { waitUntil: "domcontentloaded" });
	await page.waitForFunction(() => !!history.state?.pmHistory);
	setupStage = "read_photo_identity";
	const response = await context.request.get(`${root}/api/projects/${fixture.projectA}/files/${fixture.material.id}`);
	assert.equal(response.status(), 200); photo = (await response.json()).data;
	await check("photo_and_nonphoto_deep_links_across_filter_and_reload", async () => {
		await photoPage("&type=cad");
		acceptDialog = true;
		await page.goto(`${root}/projects/${fixture.projectA}?section=files&type=image&file=${fixture.file1.id}`, { waitUntil: "domcontentloaded" });
		acceptDialog = false;
		const response = await context.request.get(`${root}/api/projects/${fixture.projectA}/files/${fixture.file1.id}`);
		const metadata = (await response.json()).data;
		await expect(page.locator(".detail-heading h2")).toHaveText(metadata.filename);
		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(page.locator(".detail-heading h2")).toHaveText(metadata.filename);
	});
	await check("pending_deep_link_survives_tab_switch", async () => {
		acceptDialog = true;
		await page.goto(`${root}/projects/${fixture.projectA}?section=files&type=cad&file=${fixture.material.id}`, { waitUntil: "domcontentloaded" });
		acceptDialog = false;
		await expect(page.locator(".workspace-location-status")).toBeVisible();
		await page.getByRole("button", { name: "交付与版本", exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`file=${fixture.material.id}`));
		await page.getByRole("button", { name: "资料与补测", exact: true }).click();
		await expect(page.locator(".detail-heading h2")).toHaveText(photo.filename);
	});
	await check("dirty_annotation_tabs_and_native_history_keep_input", async () => {
		await photoPage(); await drawLine();
		await page.getByLabel("名称", { exact: true }).fill("FIX-B unsaved local only");
		const before = confirms;
		await page.getByRole("button", { name: "交付与版本", exact: true }).click();
		await page.getByRole("button", { name: "资料与补测", exact: true }).click();
		await page.goBack(); await page.goForward();
		await expect(page.getByLabel("名称", { exact: true })).toHaveValue("FIX-B unsaved local only");
		assert.equal(confirms, before);
	});
	await check("legacy_feature_path_cancels_back_to_root_tracked_project_list", async () => {
		// Current Chrome with Navigation API masked is a feature-path check, not an old Safari certification.
		await page.addInitScript(() => Object.defineProperty(window, "navigation", { value: undefined, configurable: true }));
		acceptDialog = true; await page.goto(`${root}/projects`, { waitUntil: "domcontentloaded" }); acceptDialog = false;
		const response = await context.request.get(`${root}/api/projects/${fixture.projectA}`);
		const project = (await response.json()).data;
		await page.getByPlaceholder("搜索项目名称或说明").fill(project.name);
		await page.getByPlaceholder("搜索项目名称或说明").press("Enter");
		const link = page.locator(`a[href^="/projects/${fixture.projectA}"]`).first();
		await expect(link).toBeVisible();
		const listPosition = await page.evaluate(() => history.state.pmHistory.position);
		await link.click();
		await page.getByRole("button", { name: `打开 ${photo.filename}`, exact: true }).click();
		await expect(page.getByRole("button", { name: "识别圆／椭圆", exact: true })).toBeEnabled();
		await drawLine(); await page.getByLabel("名称", { exact: true }).fill("FIX-B retained on legacy cancellation");
		const before = await page.evaluate(() => ({ href: location.href, length: history.length, position: history.state.pmHistory.position }));
		const priorConfirms = confirms;
		await page.evaluate(delta => history.go(delta), listPosition - before.position);
		await expect.poll(() => page.evaluate(() => location.href)).toBe(before.href);
		await expect.poll(() => confirms).toBe(priorConfirms + 1);
		await expect(page.getByLabel("名称", { exact: true })).toHaveValue("FIX-B retained on legacy cancellation");
		assert.equal(await page.evaluate(() => history.length), before.length);
	});
	await check("cv_first_load_cancel_retry_and_manual_fallback", async () => {
		await photoPage();
		await page.getByRole("button", { name: "识别圆／椭圆", exact: true }).click();
		await page.getByRole("button", { name: "取消辅助", exact: true }).click();
		await expect(page.locator(".annotation-cv-results")).toContainText("已取消");
		await page.getByRole("button", { name: "识别圆／椭圆", exact: true }).click();
		await expect(page.getByRole("button", { name: "识别圆／椭圆", exact: true })).toBeEnabled({ timeout: 35000 });
		await expect(page.locator(".annotation-cv-results")).not.toContainText("辅助暂不可用");
		await drawLine();
		await page.getByRole("button", { name: "撤销", exact: true }).click();
		await page.getByRole("button", { name: "重做", exact: true }).click();
	});
	await check("theme_help_and_narrow_dialog_keep_unsaved_input", async () => {
		await photoPage(); await drawLine();
		await page.getByLabel("名称", { exact: true }).fill("FIX-B local help input");
		for (const appearance of ["dark", "light", "system"]) {
			await page.getByLabel("外观", { exact: true }).selectOption(appearance);
			await expect(page.locator(".pm-ui").first()).toHaveAttribute("data-appearance", appearance);
		}
		await page.locator(".engineering-guidance > summary").click();
		await page.getByLabel("测量方式", { exact: true }).selectOption("outside");
		await page.locator(".measurement-help > summary").first().click();
		await page.getByText("游标卡尺怎么读", { exact: true }).click();
		await expect(page.getByLabel("名称", { exact: true })).toHaveValue("FIX-B local help input");
		await page.setViewportSize({ width: 390, height: 844 });
		await page.getByRole("button", { name: "标注与属性", exact: true }).click();
		await expect(page.locator(".workspace-context-dialog")).toBeVisible();
		await expect(page.getByLabel("名称", { exact: true })).toHaveValue("FIX-B local help input");
		const width = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
		assert.ok(width.page <= width.viewport + 1);
		await page.getByRole("button", { name: "关闭标注信息", exact: true }).click();
		await page.getByRole("button", { name: "标注与属性", exact: true }).click();
		await expect(page.getByLabel("名称", { exact: true })).toHaveValue("FIX-B local help input");
		await page.screenshot({ path: `tmp/fix-b/narrow-${run}.png`, fullPage: false });
	});
	await check("inbox_modal_fast_reopen_preserves_lock_and_restores_focus", async () => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		await photoPage();
		const trigger = page.locator(".task-inbox-fab"), dialog = page.locator(".task-inbox-dialog");
		await trigger.click(); await expect(dialog).toBeVisible();
		await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
		await page.getByRole("button", { name: "关闭待办", exact: true }).click();
		await trigger.click(); await expect(dialog).toBeVisible();
		await page.getByRole("button", { name: "关闭待办", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
		await expect(trigger).toBeFocused();
	});
} catch (error) {
	setupError = { stage: setupStage, errorType: ["TimeoutError", "AssertionError", "Error"].includes(error.name) ? error.name : "OTHER" };
	results.push({ name: "browser_setup", status: "NOT_PASSED", code: "SETUP_OR_AUTH_FAILED", ...setupError });
	console.log(JSON.stringify(results.at(-1))); process.exitCode = 1;
} finally {
	await mkdir("docs/evidence/fix-b", { recursive: true });
	await writeFile(`docs/evidence/fix-b/browser-${run}.json`, `${JSON.stringify({ checkedAt: new Date().toISOString(), browser: browser.version(), scope: "Explicitly authorized current local app + real Owner read session; unsaved edits only, all other API writes blocked. Current Chrome, with a masked Navigation API feature-path subcase; narrow viewport is not a real phone/soft keyboard/old Safari test.", authResponses, blockedWrites, pageErrors: errors.length, consoleErrors, results }, null, 2)}\n`);
	await context.close(); await browser.close();
}
