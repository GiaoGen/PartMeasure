// Normal UI + real application APIs. Only the explicitly named failure-state check mocks one response.
// No trace/HAR, tokens, cookies, passwords or raw browser errors are recorded.
import { chromium, expect as baseExpect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { context, call, requireData, root } from "./helpers.mjs";
const fixture = JSON.parse(await readFile("tmp/p0-2/fixture.json", "utf8")),
	results = [];
const expect = baseExpect.configure({ timeout: 45000 });
const browser = await chromium.launch({
	headless: true,
	...(process.env.HTTPS_PROXY
		? {
				proxy: {
					server: process.env.HTTPS_PROXY,
					bypass: "localhost,127.0.0.1",
				},
			}
		: {}),
});
const owner = await browser.newContext({
		baseURL: root,
		viewport: { width: 1500, height: 1000 },
	}),
	page = await owner.newPage(),
	a = await context("A");
const accounts = JSON.parse(
	await readFile("tmp/p0-1/test-accounts.json", "utf8"),
);
await requireData(
	await call(owner.request, "/api/auth/login", "POST", accounts.A),
);
const O = `/api/projects/${fixture.projectA}`,
	G = `/api/guest/projects/${fixture.projectA}`;
const httpFailures = [],imageRetries=[];
page.on("response", (r) => {
	if (r.status() >= 400 && r.url().startsWith(`${root}/api/`))
		httpFailures.push({ path: new URL(r.url()).pathname, status: r.status() });
});
await mkdir("docs/evidence/p0-2/screenshots", { recursive: true });
page.setDefaultTimeout(60000);
page.on("dialog", (d) => d.accept());
let unique = `浏览器线段 ${Date.now()}`;
let id, saved;
const recoveryOnly = process.env.P02_RECOVERY === "1",
	filesOnly = process.env.P02_FILES === "1";
async function check(name, work) {
	if (
		recoveryOnly &&
		!name.startsWith("simulated-") &&
		!name.startsWith("real-concurrent-")
	)
		return;
	if (
		filesOnly &&
		!name.startsWith("file-question-") &&
		!name.startsWith("mobile-guest-")
	)
		return;
	process.stdout.write(`start: ${name}\n`);
	try {
		await work();
		results.push({ check: name, status: "PASS" });
	} catch (e) {
		results.push({
			check: name,
			status: "FAIL",
			code: /^HTTP_\d+_[A-Z_]+$/.test(e.message) ? e.message : e.name,
			location: e.stack
				?.split("\n")
				.find((line) => line.includes("scripts/p0-2/browser.mjs"))
				?.trim(),
		});
		await page
			.screenshot({
				path: `docs/evidence/p0-2/screenshots/failure-${name}.png`,
				timeout: 10000,
				fullPage: true,
				mask: [
					page.locator(
						'input[type=password],input[type=email],input[aria-label="新分享地址"]',
					),
				],
			})
			.catch(() => {});
		await writeFile(
			`tmp/p0-2/browser-error-${name}.txt`,
			e.message.replaceAll(fixture.shareUrl, "[REDACTED]"),
		);
	}
	await writeFile("tmp/p0-2/browser-progress.json", JSON.stringify(results));
	process.stdout.write(`${name}: ${results.at(-1).status}\n`);
}
async function openImage(p) {
	await p.getByRole("button", { name: /定位试样-横图.png/ }).click();
	await expect(p.locator(".annotation-viewport canvas")).toBeVisible();
	try {await expect(p.locator('.canvas-message')).toHaveCount(0);}catch(error){
		const retry=p.getByRole('button',{name:'重试图片',exact:true});if(!await retry.isVisible())throw error;
		imageRetries.push({actor:p===page?'owner':'guest',action:'one-normal-retry-after-visible-image-error'});await retry.click();await expect(p.locator('.canvas-message')).toHaveCount(0);
	}
	await assertImagePixels(p);
}
async function assertImagePixels(p){
	const pixel=await p.locator('.annotation-viewport').evaluate(host=>{const canvas=host.querySelector('canvas'),rect=canvas.getBoundingClientRect(),ratio=canvas.width/rect.width,x=+host.dataset.panX+.68*+host.dataset.imageWidth*+host.dataset.scale,y=+host.dataset.panY+.4*+host.dataset.imageHeight*+host.dataset.scale;return Array.from(canvas.getContext('2d').getImageData(Math.round(x*ratio),Math.round(y*ratio),1,1).data);});
	assert.equal(pixel[3],255);assert.ok(Math.abs(pixel[0]-215)<=12&&Math.abs(pixel[1]-222)<=12&&Math.abs(pixel[2]-229)<=12);
}
async function at(p, x, y) {
	const host = p.locator(".annotation-viewport"),
		box = await host.boundingBox(),
		v = await host.evaluate((el) => ({
			w: +el.dataset.imageWidth,
			h: +el.dataset.imageHeight,
			s: +el.dataset.scale,
			x: +el.dataset.panX,
			y: +el.dataset.panY,
		}));
	return {
		x: box.x + 1 + v.x + x * v.w * v.s,
		y: box.y + 1 + v.y + y * v.h * v.s,
	};
}
async function draw(p, x1, y1, x2, y2) {
	await p.locator(".annotation-viewport").scrollIntoViewIfNeeded();
	const start = await at(p, x1, y1),
		end = await at(p, x2, y2);
	await p.mouse.move(start.x, start.y);
	await p.mouse.down();
	await p.mouse.move(end.x, end.y, { steps: 10 });
	await p.mouse.up();
}
async function save() {
	await page.getByRole("button", { name: "保存标注", exact: true }).click();
	await expect(
		page.locator(".editor-status").getByRole("status").first(),
	).toHaveText("已保存", { timeout: 60000 });
}
async function imageDoc() {
	return requireData(await call(a, `${O}/files/${fixture.image}/annotations`));
}
try {
	if (recoveryOnly || filesOnly) {
		const doc = await imageDoc();
		saved = doc.items
			.filter((i) => !i.deleted && i.metadata.name.startsWith("浏览器线段 "))
			.sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
		assert.ok(saved);
		id = saved.id;
		unique = saved.metadata.name;
		await page.goto(`${root}/projects/${fixture.projectA}`);
		await openImage(page);
		await page
			.locator(".annotation-list")
			.getByRole("button", { name: new RegExp(unique) })
			.click();
	}
	await check("desktop-draw-fields-save-and-session-undo-redo", async () => {
		await page.goto(`${root}/projects/${fixture.projectA}`);
		await openImage(page);
		await page.getByRole("button", { name: "线段", exact: true }).click();
		await draw(page, 0.2, 0.24, 0.65, 0.24);
		await page.getByLabel("名称", { exact: true }).fill(unique);
		await page.getByLabel("人工尺寸", { exact: true }).fill("23.75");
		await save();
		saved = (await imageDoc()).items.find((i) => i.metadata.name === unique);
		assert.ok(saved);
		id = saved.id;
		assert.equal(saved.metadata.dimension, "23.75");
		assert.ok(Math.abs(saved.geometry.from.y - saved.geometry.to.y) < 0.005);
		await page
			.getByRole("button", { name: "删除选中标注", exact: true })
			.click();
		await expect(page.getByLabel("名称", { exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: "撤销", exact: true }).click();
		await expect(
			page
				.locator(".annotation-list")
				.getByRole("button", { name: new RegExp(unique) }),
		).toBeVisible();
		await page.getByRole("button", { name: "重做", exact: true }).click();
		await expect(
			page
				.locator(".annotation-list")
				.getByRole("button", { name: new RegExp(unique) }),
		).toHaveCount(0);
		await page.getByRole("button", { name: "撤销", exact: true }).click();
		await page
			.locator(".annotation-list")
			.getByRole("button", { name: new RegExp(unique) })
			.click();
	});
	await check(
		"drag-and-zoom-resize-hit-position-without-geometry-drift",
		async () => {
			assert.ok(id);
			await page.getByRole("button", { name: "选择", exact: true }).click();
			const mid = {
				x: (saved.geometry.from.x + saved.geometry.to.x) / 2,
				y: saved.geometry.from.y,
			};
			await draw(page, mid.x, mid.y, mid.x + 0.035, mid.y + 0.04);
			await save();
			const moved = (await imageDoc()).items.find((i) => i.id === id);
			assert.ok(
				Math.abs(moved.geometry.from.x - saved.geometry.from.x - 0.035) < 0.005,
			);
			assert.ok(
				Math.abs(moved.geometry.from.y - saved.geometry.from.y - 0.04) < 0.005,
			);
			assert.equal(moved.metadata.dimension, "23.75");
			saved = moved;
			await page.getByRole("button", { name: "放大", exact: true }).click();
			await page.setViewportSize({ width: 1250, height: 900 });
			await page.waitForTimeout(300);
			await page.locator(".annotation-viewport").focus();
			await page.keyboard.press("Escape");
			const hit = await at(
				page,
				(saved.geometry.from.x + saved.geometry.to.x) / 2,
				saved.geometry.from.y,
			);
			await page.mouse.click(hit.x, hit.y);
			await expect(page.getByLabel("名称", { exact: true })).toHaveValue(
				unique,
			);
			assert.deepEqual(
				(await imageDoc()).items.find((i) => i.id === id).geometry,
				saved.geometry,
			);
		},
	);
	await check("reload-reenter-persistence-and-history-preview", async () => {
		assert.ok(id);
		await page.reload();
		await openImage(page);
		await page
			.locator(".annotation-list")
			.getByRole("button", { name: new RegExp(unique) })
			.click();
		await expect(page.getByLabel("人工尺寸", { exact: true })).toHaveValue(
			"23.75",
		);
		await page
			.locator(".annotation-list")
			.getByRole("button", { name: /^长度 L1/ })
			.first()
			.click();
		await page.getByRole("button", { name: "修订历史", exact: true }).click();
		await expect(
			page.getByRole("button", { name: /修订 #1 · 保存/ }),
		).toBeVisible();
		await page.getByRole("button", { name: /修订 #1 · 保存/ }).click();
		await expect(
			page.getByRole("button", { name: "保存标注", exact: true }),
		).toBeDisabled();
		await page
			.getByRole("button", { name: "返回当前标注", exact: true })
			.click();
		await page
			.locator(".annotation-list")
			.getByRole("button", { name: /^孔 A/ })
			.first()
			.click();
		await expect(page.getByLabel("螺纹规格", { exact: true })).toHaveValue(
			"M6 × 1",
		);
		await page.screenshot({
			path: "docs/evidence/p0-2/screenshots/owner-desktop.png",
			fullPage: true,
		});
	});
	await check(
		"simulated-503-retains-draft-and-retry-key-real-save",
		async () => {
			assert.ok(id);
			await page
				.locator(".annotation-list")
				.getByRole("button", { name: new RegExp(unique) })
				.click();
			await page
				.getByLabel("备注", { exact: true })
				.fill("失败后保留，重试真实保存");
			const keys = [];
			let first = true;
			const pattern = `**/annotations/${id}`;
			await page.route(pattern, async (route) => {
				if (route.request().method() !== "PATCH") {
					await route.continue();
					return;
				}
				keys.push(route.request().headers()["idempotency-key"]);
				if (first) {
					first = false;
					await route.fulfill({
						status: 503,
						contentType: "application/json",
						body: JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE" } }),
					});
				} else await route.continue();
			});
			await page.getByRole("button", { name: "保存标注", exact: true }).click();
			await expect(
				page.getByRole("button", { name: "重试保存", exact: true }),
			).toBeEnabled();
			await expect(page.getByLabel("备注", { exact: true })).toHaveValue(
				"失败后保留，重试真实保存",
			);
			await expect(page.getByLabel("备注", { exact: true })).toBeDisabled();
			await page.screenshot({
				path: "docs/evidence/p0-2/screenshots/save-retry.png",
				fullPage: true,
			});
			await page.getByRole("button", { name: "重试保存", exact: true }).click();
			await expect(
				page.locator(".editor-status").getByRole("status").first(),
			).toHaveText("已保存", { timeout: 60000 });
			assert.equal(keys.length, 2);
			assert.ok(keys[0]);
			assert.equal(keys[0], keys[1]);
			await page.unroute(pattern);
			assert.equal(
				(await imageDoc()).items.find((i) => i.id === id).metadata.notes,
				"失败后保留，重试真实保存",
			);
		},
	);
	await check(
		"real-concurrent-edit-conflict-never-silently-overwrites",
		async () => {
			assert.ok(id);
			const doc = await imageDoc(),
				head = doc.items.find((i) => i.id === id);
			await page.getByLabel("备注", { exact: true }).fill("本地冲突草稿");
			await requireData(
				await call(
					a,
					`${O}/annotations/${id}`,
					"PATCH",
					{
						imageHash: doc.image.imageHash,
						geometry: head.geometry,
						metadata: { ...head.metadata, notes: "另一个会话已保存" },
					},
					{ revision: head.revision },
				),
			);
			await page.getByRole("button", { name: "保存标注", exact: true }).click();
			await expect(
				page.getByRole("button", { name: "重新载入已保存版本", exact: true }),
			).toBeVisible();
			await expect(page.getByLabel("备注", { exact: true })).toHaveValue(
				"本地冲突草稿",
			);
			await expect(
				page.getByRole("button", { name: "重试保存", exact: true }),
			).toBeDisabled();
			await page.screenshot({
				path: "docs/evidence/p0-2/screenshots/save-conflict.png",
				fullPage: true,
			});
			await page
				.getByRole("button", { name: "重新载入已保存版本", exact: true })
				.click();
			await page
				.locator(".annotation-list")
				.getByRole("button", { name: new RegExp(unique) })
				.click();
			await expect(page.getByLabel("备注", { exact: true })).toHaveValue(
				"另一个会话已保存",
			);
		},
	);
	const question = `浏览器文件问题 ${Date.now()}`;
	await check("file-question-create-refresh", async () => {
		await page.getByRole("button", { name: /文件问题示例.step/ }).click();
		await page.getByLabel("问题标题", { exact: true }).fill(question);
		await page
			.getByLabel("问题说明", { exact: true })
			.fill("仅文件级说明，回复与审核尚未开放。");
		await page
			.getByRole("button", { name: "保存文件问题", exact: true })
			.click();
		await expect(
			page.getByText("文件问题已保存", { exact: true }),
		).toBeVisible();
		await page.reload();
		await page.getByRole("button", { name: /文件问题示例.step/ }).click();
		await expect(page.getByText(question, { exact: true })).toBeVisible();
		await page.screenshot({
			path: "docs/evidence/p0-2/screenshots/file-question.png",
			fullPage: true,
		});
	});
	await check(
		"mobile-guest-bootstrap-readonly-same-geometry-and-file-question",
		async () => {
			const mobile = await browser.newContext({
					baseURL: root,
					viewport: { width: 390, height: 844 },
					deviceScaleFactor: 3,
					isMobile: true,
					hasTouch: true,
				}),
				p = await mobile.newPage();
			p.setDefaultTimeout(60000);
			p.on('response',r=>{if(r.status()>=400&&r.url().startsWith(`${root}/api/`))httpFailures.push({actor:'guest',path:new URL(r.url()).pathname,status:r.status()});});
			try {
				await p.goto(fixture.shareUrl);
				await p.waitForURL("**/s/session?project=*");
				await openImage(p);
				await expect(p.getByRole("toolbar", { name: "标注工具" })).toHaveCount(
					0,
				);
				await expect(
					p.getByRole("button", { name: "保存标注", exact: true }),
				).toHaveCount(0);
				await p
					.locator(".annotation-list")
					.getByRole("button", { name: /^孔 A/ })
					.first()
					.click();
				await expect(
					p.getByText("螺纹：M6 × 1", { exact: true }),
				).toBeVisible();
				await expect(p.locator(".engineering-fields")).toHaveCount(0);
				await p.getByRole("button", { name: "放大", exact: true }).click();
				await p.getByRole("button", { name: "适应视口", exact: true }).click();
				const before = await imageDoc();
				await p.screenshot({
					path: "docs/evidence/p0-2/screenshots/guest-mobile.png",
					fullPage: true,
				});
				const guestDoc = await requireData(
					await call(p.request, `${G}/files/${fixture.image}/annotations`),
				);
				assert.deepEqual(
					guestDoc.items.find((i) => i.id === id).geometry,
					before.items.find((i) => i.id === id).geometry,
				);
				await p
					.getByRole("button", { name: "返回资料列表", exact: true })
					.click();
				await p.getByRole("button", { name: /文件问题示例.step/ }).click();
				await expect(p.getByText(question, { exact: true })).toBeVisible();
				await expect(
					p.getByRole("button", { name: "保存文件问题", exact: true }),
				).toHaveCount(0);
			} finally {
				await mobile.close();
			}
		},
	);
} finally {
	await a.dispose();
	await owner.close();
	await browser.close();
}
await writeFile(
	`docs/evidence/p0-2/${recoveryOnly ? "browser-recovery" : filesOnly ? "browser-files" : "browser"}.json`,
	`${JSON.stringify({ checkedAt: new Date().toISOString(), productionBuild: true, realServiceExceptExplicit503: true, physicalPhone: false, actualImagePixelsChecked:true, httpFailures,imageRetries, results }, null, 2)}\n`,
);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
