// Normal browser credentials, real app/database/private Storage. No traces/HAR or credential logging.
import { chromium, expect as baseExpect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import sharp from "sharp";
import { call, requireData, root } from "../p0-2/helpers.mjs";
const expect = baseExpect.configure({ timeout: 45000 }),
	f = JSON.parse(await readFile("tmp/p0-3/fixture.json", "utf8")),
	accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
await mkdir("docs/evidence/p0-3/screenshots", { recursive: true });
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
	mobile = await browser.newContext({
		baseURL: root,
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
	}),
	page = await owner.newPage(),
	guest = await mobile.newPage(),
	a = owner.request;
const O = `/api/projects/${f.projectA}`,
	results = [],
	httpFailures = [], uiRetries = [], photoOnly = process.argv.includes("--photo-only");
let active = page;
for (const [actor, p] of [
	["owner", page],
	["guest", guest],
]) {
	p.setDefaultTimeout(60000);
	p.on("dialog", (d) => d.accept());
	p.on("response", (r) => {
		if (r.status() >= 400 && r.url().startsWith(`${root}/api/`))
			httpFailures.push({
				actor,
				path: new URL(r.url()).pathname,
				status: r.status(),
			});
	});
}
const stamp = Date.now(),
	numericTitle = `浏览器 · 数值审核 ${stamp}`,
	photoTitle = `浏览器 · 仅照片 ${stamp}`;
let targetName = `浏览器测量目标 ${stamp}`;
let annotation, numeric, photo;
function redact(text) {
	for (const value of [
		f.shareUrl,
		f.shareUrl.split("/").pop(),
		...Object.values(accounts).flatMap((x) => [x.password, x.email]),
	])
		text = text.replaceAll(value, "[REDACTED]");
	return text;
}
async function check(name, work) {
	process.stdout.write(`start: ${name}\n`);
	try {
		await work();
		results.push({ check: name, status: "PASS" });
	} catch (e) {
		results.push({
			check: name,
			status: "FAIL",
			code: /^HTTP_\d+_[A-Z_]+$/.test(e.message) ? e.message : e.name,
		});
		await writeFile(`tmp/p0-3/browser-${name}.txt`, redact(e.message));
		await active
			.screenshot({
				path: `docs/evidence/p0-3/screenshots/failure-${name}.png`,
				fullPage: true,
				timeout: 10000,
				mask: [
					active.locator(
						'input[type=password],input[type=email],input[aria-label="新分享地址"]',
					),
				],
			})
			.catch(() => {});
	}
	await writeFile("tmp/p0-3/browser-progress.json", JSON.stringify(results));
	process.stdout.write(`${name}: ${results.at(-1).status}\n`);
}
async function shot(p, name) {
	if (await p.locator(".issue-target .annotation-viewport").count()) await imageReady(p, ".issue-target");
	await p.screenshot({
		path: `docs/evidence/p0-3/screenshots/${name}.png`,
		fullPage: true,
	});
}
async function imageReady(p, scope = "") {
	const area = scope ? p.locator(scope) : p;
	try { await expect(area.locator(".canvas-message")).toHaveCount(0); }
	catch (error) {
		const retry = area.getByRole("button", { name: "重试图片", exact: true });
		if (!(await retry.isVisible())) throw error;
		uiRetries.push({ action: "existing-image-retry-button", scope: scope || "source-editor" });
		await retry.click();
		await expect(area.locator(".canvas-message")).toHaveCount(0);
	}
}
async function task(p, title) {
	const details = p.locator(".issue-inbox details");
	if (!(await details.evaluate((d) => d.open)))
		await details.locator("summary").click();
	const button = p.locator(".issue-inbox-list").getByRole("button", { name: new RegExp(title) });
	for (let n = 0; n < 10 && !(await button.count()); n++) {
		const more = details.getByRole("button", { name: "更多任务", exact: true });
		if (!(await more.count())) break;
		await more.click();
		await expect(p.getByText("读取任务…", { exact: true })).toHaveCount(0);
	}
	await button.click();
	await expect(p.locator(".issue-detail > .detail-heading h2")).toHaveText(title);
}
async function refreshTask(p, title) {
	await p.getByRole("button", { name: "刷新任务", exact: true }).click();
	await task(p, title);
}
async function targetReady(p) {
	await expect(
		p.locator(".issue-target .annotation-viewport canvas"),
	).toBeVisible();
	await imageReady(p, ".issue-target");
	const rgba = await p
		.locator(".issue-target .annotation-viewport")
		.evaluate((el) => {
			const c = el.querySelector("canvas"),
				rect = c.getBoundingClientRect(),
				r = c.width / rect.width,
				x =
					+el.dataset.panX + 0.68 * +el.dataset.imageWidth * +el.dataset.scale,
				y =
					+el.dataset.panY + 0.4 * +el.dataset.imageHeight * +el.dataset.scale;
			return Array.from(
				c
					.getContext("2d")
					.getImageData(Math.round(x * r), Math.round(y * r), 1, 1).data,
			);
		});
	assert.equal(rgba[3], 255);
	assert.ok(Math.abs(rgba[0] - 215) < 15);
}
async function createFromUi(title) {
	await page.getByRole("button", { name: "继续上传资料", exact: true }).click();
	await page.getByRole("button", { name: /定位试样-横图.png/ }).click();
	await expect(page.locator(".annotation-viewport canvas")).toBeVisible();
	await imageReady(page);
	await page
		.locator(".annotation-list")
		.getByRole("button", { name: targetName, exact: true })
		.click();
	await page.getByText("创建测量请求", { exact: true }).click();
	const form = page.locator(".measurement-create form");
	await form.getByLabel("请求题目", { exact: true }).fill(title);
	await form
		.getByLabel("目标信息", { exact: true })
		.fill("左上圆孔的内径，请手动测量或上传测量照片。");
	await form.getByLabel(/^建议测量方式/).selectOption("inside");
	await form
		.getByLabel("操作要求", { exact: true })
		.fill("不要从图片像素推算尺寸，无法测量时说明原因。");
	await form.getByRole("button", { name: "保存测量请求", exact: true }).click();
	process.stdout.write("request form submitted\n");
	await expect(
		page.getByText("测量请求已创建，可在上方任务列表中查看。", { exact: true }),
	).toBeVisible();
	const list = await requireData(await call(a, `${O}/issues`));
	const found = list.items.find((i) => i.title === title);
	assert.ok(found);
	return found;
}
try {
	await check(
		photoOnly ? "normal-password-login-and-resume-existing-saved-target" : "normal-password-login-and-owner-creates-fixed-target-request-in-ui",
		async () => {
			active = page;
			await page.goto(`${root}/login`);
			await page.getByLabel("邮箱", { exact: true }).fill(accounts.A.email);
			await page.getByLabel(/^密码/).fill(accounts.A.password);
			await page.getByRole("button", { name: "登录", exact: true }).click();
			process.stdout.write("owner login submitted through normal UI\n");
			await page.waitForURL("**/projects");
			process.stdout.write(photoOnly ? "owner login restored; reusing saved annotation\n" : "owner login restored; creating saved annotation\n");
			if (photoOnly) {
				const saved = await requireData(await call(a, `${O}/files/${f.image}/annotations`));
				annotation = saved.items.find(x => x.id === f.p03.browser.annotation);
				assert.ok(annotation);
				targetName = annotation.metadata.name;
				await page.goto(`${root}/projects/${f.projectA}`);
				await guest.goto(f.shareUrl);
				await guest.waitForURL("**/s/session?project=*");
				return;
			}
			const image = (
				await requireData(await call(a, `${O}/files/${f.image}/annotations`))
			).image;
			annotation = await requireData(
				await call(a, `${O}/annotations`, "POST", {
					id: randomUUID(),
					fileId: f.image,
					imageHash: image.imageHash,
					geometry: {
						type: "circle",
						center: { x: 0.25, y: 0.35 },
						radiusX: 72 / 1600,
						radiusY: 72 / 1000,
					},
					metadata: {
						name: targetName,
						dimension: "",
						unit: "mm",
						source: "human",
						circleMeasure: "diameter",
						holeDepth: "",
						holeType: "",
						thread: "",
						notes: "",
					},
				}),
				201,
			);
			await page.goto(`${root}/projects/${f.projectA}`);
			numeric = await createFromUi(numericTitle);
			assert.equal(
				(await requireData(await call(a, `${O}/issues/${numeric.id}`))).target
					.annotationRef.id,
				annotation.id,
			);
			await shot(page, "owner-create");
		},
	);
	if (!photoOnly) { await check(
		"mobile-guest-priority-real-image-three-options-numeric-submit-refresh",
		async () => {
			active = guest;
			assert.ok(numeric);
			await guest.goto(f.shareUrl);
			await guest.waitForURL("**/s/session?project=*");
			await expect(guest.locator(".issue-detail > .detail-heading h2")).toHaveText(numericTitle);
			await targetReady(guest);
			process.stdout.write("guest fixed target real pixels verified\n");
			await expect(
				guest.getByRole("toolbar", { name: "标注工具" }),
			).toHaveCount(0);
			for (const name of ["填数值和单位", "仅上传测量照片", "无法测量并说明"])
				await expect(
					guest.getByRole("button", { name, exact: true }),
				).toBeVisible();
			await guest.getByLabel("测量数值", { exact: true }).fill("12.75");
			await guest.getByLabel(/^测量单位/).selectOption("mm");
			await guest
				.getByLabel("回复说明", { exact: true })
				.fill("手机viewport真实数值回复");
			await shot(guest, "guest-numeric");
			await guest
				.getByRole("button", { name: "提交回复", exact: true })
				.click();
			process.stdout.write("guest numeric response submitted\n");
			await expect(guest.locator(".issue-state")).toContainText(
				"待工程师审核",
				{ timeout: 60000 },
			);
			await expect(
				guest.getByRole("button", { name: "提交回复", exact: true }),
			).toHaveCount(0);
			await guest.reload();
			await task(guest, numericTitle);
			await expect(guest.locator(".issue-state")).toContainText("待工程师审核");
			await expect(
				guest.getByText("原回复：12.75 mm", { exact: true }),
			).toBeVisible();
		},
	);
	await check(
		"owner-review-manual-correction-source-and-guest-confirmed-history",
		async () => {
			active = page;
			assert.ok(numeric);
			await refreshTask(page, numericTitle);
			const form = page.getByRole("form", { name: "工程师审核" });
			await expect(form).toBeVisible();
			await targetReady(page);
			await shot(page, "owner-review");
			await form
				.getByLabel(/^最终值来源/)
				.selectOption("owner_manual");
			await form.getByLabel("最终确认值", { exact: true }).fill("12.8");
			await form
				.getByLabel("审核说明", { exact: true })
				.fill("人工核对测试证据后修正，保留原12.75；非真实工程尺寸");
			await form
				.getByRole("button", { name: "保存审核决定", exact: true })
				.click();
			await expect(page.locator(".issue-state")).toContainText("已确认", {
				timeout: 60000,
			});
			const d = await requireData(await call(a, `${O}/issues/${numeric.id}`));
			assert.equal(d.responses[0].value, "12.75");
			assert.equal(d.reviews[0].value, "12.8");
			assert.equal(d.reviews[0].source, "owner_manual");
			active = guest;
			await guest.reload();
			await task(guest, numericTitle);
			await expect(guest.locator(".issue-state")).toContainText("已确认");
			await expect(
				guest.getByText("原回复：12.75 mm", { exact: true }),
			).toBeVisible();
			await shot(guest, "guest-confirmed");
		},
	);
	}
	await check(
		"photo-only-real-private-upload-processing-evidence-and-manual-review",
		async () => {
			active = page;
			photo = await createFromUi(photoTitle);
			active = guest;
			await refreshTask(guest, photoTitle);
			await targetReady(guest);
			await guest
				.getByRole("button", { name: "仅上传测量照片", exact: true })
				.click();
			await expect(guest.getByLabel("测量数值", { exact: true })).toHaveCount(
				0,
			);
			const filename = `p03-browser-evidence-${stamp}.png`,
				path = `tmp/p0-3/${filename}`;
			const svg = `<svg width="800" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="500" fill="#e7ecf1"/><rect x="90" y="160" width="620" height="90" fill="#aebccc"/><path d="M120 110V350H250V290M580 110V350H450V290" stroke="#39475a" fill="none" stroke-width="16"/><text x="40" y="60" font-size="23">SYNTHETIC TEST EVIDENCE - NOT A REAL MEASUREMENT</text><text x="80" y="420" font-size="24">Human input only - ${stamp}</text></svg>`;
			await sharp(Buffer.from(svg)).png().toFile(path);
			const evidence = guest.getByRole("region", { name: "本次回复证据" });
			await evidence.locator("input[type=file]").setInputFiles(path);
			process.stdout.write("guest evidence selected for real upload\n");
			await expect(
				evidence.getByText("已完成 · 工程师和客户可查看", { exact: true }),
			).toBeVisible({ timeout: 240000 });
			await expect(
				evidence.getByRole("checkbox", { name: new RegExp(filename) }),
			).toBeVisible({ timeout: 60000 });
			await evidence
				.getByRole("checkbox", { name: new RegExp(filename) })
				.check();
			await guest
				.getByLabel("回复说明", { exact: true })
				.fill("仅上传合成测试照片，没有填写数值");
			await shot(guest, "guest-photo");
			await guest
				.getByRole("button", { name: "提交回复", exact: true })
				.click();
			await expect(guest.locator(".issue-state")).toContainText(
				"待工程师审核",
				{ timeout: 60000 },
			);
			const submitted = await requireData(
				await call(a, `${O}/issues/${photo.id}`),
			);
			assert.equal(submitted.responses[0].value, null);
			assert.equal(submitted.responses[0].attachments.length, 1);
			active = page;
			await refreshTask(page, photoTitle);
			const form = page.getByRole("form", { name: "工程师审核" });
			await expect(form.getByLabel("最终确认值", { exact: true })).toHaveValue(
				"",
			);
			await expect(page.locator(".evidence-gallery img")).toBeVisible();
			await expect
				.poll(() =>
					page
						.locator(".evidence-gallery img")
						.evaluate((img) => img.complete && img.naturalWidth > 0),
				)
				.toBe(true);
			await shot(page, "owner-photo-evidence");
			await form.getByLabel("最终确认值", { exact: true }).fill("10.15");
			await form
				.getByLabel("审核说明", { exact: true })
				.fill("合成测试照片人工录入示例，不代表真实工程尺寸");
			await form
				.getByRole("button", { name: "保存审核决定", exact: true })
				.click();
			await expect(page.locator(".issue-state")).toContainText("已确认", {
				timeout: 60000,
			});
			assert.equal(
				(await requireData(await call(a, `${O}/issues/${photo.id}`))).reviews[0]
					.source,
				"owner_from_photo",
			);
		},
	);
	f.p03.browser = {
		...f.p03.browser,
		annotation: annotation?.id,
		...(numeric ? { numeric: numeric.id } : {}),
		...(photo ? { photo: photo.id } : {}),
	};
	await writeFile("tmp/p0-3/fixture.json", JSON.stringify(f));
} finally {
	await owner.close();
	await mobile.close();
	await browser.close();
}
await writeFile(
	photoOnly ? "docs/evidence/p0-3/browser-photo-retry.json" : "docs/evidence/p0-3/browser.json",
	`${JSON.stringify({ checkedAt: new Date().toISOString(), productionBuild: true, realAuthDatabaseStorage: true, syntheticEvidencePhoto: true, physicalPhone: false, httpFailures, uiRetries, results }, null, 2)}\n`,
);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
