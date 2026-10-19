// Normal UI, real app APIs, real private Storage. No auth bypass, traces or HAR.
import { chromium, expect as baseExpect } from "@playwright/test";
import { browserNetwork } from "../shared/browser-network.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import sharp from "sharp";
import { root, accounts, call, requireData, safeCode } from "./helpers.mjs";
const expect = baseExpect.configure({ timeout: 60000 }),
	results = [],
	httpFailures = [];
await mkdir("docs/evidence/p0-4/screenshots", { recursive: true });
const browser = await chromium.launch({
	headless: true,
	...browserNetwork(),
});
const owner = await browser.newContext({
		baseURL: root,
		viewport: { width: 1500, height: 1050 },
	}),
	mobile = await browser.newContext({
		baseURL: root,
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
		acceptDownloads: true,
	});
const page = await owner.newPage(),
	guest = await mobile.newPage();
const deliveryOnly = process.argv.includes("--delivery-only");
const resume = process.argv.includes("--resume") || deliveryOnly;
let active = page,
	f = resume
		? JSON.parse(await readFile("tmp/p0-4/browser-fixture.json", "utf8"))
		: { stamp: Date.now(), root },
	O,
	G;
const pngPath = "tmp/p0-4/manual-sample.png",
	stepPath = "tmp/p0-4/large-delivery.step";
const img = await sharp({
	create: { width: 1200, height: 800, channels: 3, background: "#d5dde6" },
})
	.composite([
		{
			input: Buffer.from(
				`<svg width="1200" height="800"><rect x="160" y="150" width="850" height="480" rx="20" fill="#afb9c6"/><circle cx="370" cy="360" r="65" fill="white" stroke="black" stroke-width="6"/><text x="40" y="750" font-size="30">SYNTHETIC P04 ${f.stamp} - NOT REAL DIMENSIONS</text></svg>`,
			),
		},
	])
	.png()
	.toBuffer();
await writeFile(pngPath, img);
const step = Buffer.from(
	`ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('SYNTHETIC P04'),'2;1');\nENDSEC;\nDATA;\n/*${" synthetic test padding ".repeat(330000)}*/\nENDSEC;\nEND-ISO-10303-21;\n`,
);
await writeFile(stepPath, step);
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
async function shot(p, name) {
	await p.screenshot({
		path: `docs/evidence/p0-4/screenshots/${name}.png`,
		fullPage: true,
		mask: [
			p.locator(
				'input[type=password],input[type=email],input[aria-label="新分享地址"]',
			),
		],
	});
}
async function check(name, work) {
	console.log(`start: ${name}`);
	try {
		await work();
		results.push({ check: name, status: "PASS" });
	} catch (e) {
		results.push({
			check: name,
			status: "FAIL",
			code: safeCode(e),
			location: e.stack
				?.split("\n")
				.find((x) => x.includes("scripts/p0-4/browser.mjs"))
				?.trim(),
		});
		const secrets = [
			f.shareUrl,
			f.shareUrl?.split("/").pop(),
			...Object.values(accounts).flatMap((x) => [x.password, x.email]),
		].filter(Boolean);
		let m = e.message;
		for (const s of secrets) m = m.replaceAll(s, "[REDACTED]");
		await writeFile("tmp/p0-4/browser-error.txt", m);
		await shot(active, `failure-${name}`).catch(() => {});
	}
	await writeFile(
		"docs/evidence/p0-4/browser-progress.json",
		JSON.stringify(
			{ root, checkedAt: new Date().toISOString(), httpFailures, results },
			null,
			2,
		),
	);
	console.log(`${name}: ${results.at(-1).status}`);
	if (results.at(-1).status === "FAIL") throw Error("SCENARIO_STOPPED");
}
async function uploadInUi(_p, region, files, delivery = false) {
	await region.locator("input[type=file]").setInputFiles(files);
	await expect(
		region.getByText(
			delivery
				? "已完成 · 仅工程师可见，发布后开放客户"
				: "已完成 · 工程师和客户可查看",
			{ exact: true },
		),
	).toHaveCount(files.length, { timeout: 300000 });
}
async function task(p, title) {
	const inbox = p.locator(".issue-inbox");
	const details = inbox.locator("details");
	if (!(await details.evaluate((d) => d.open)))
		await details.locator("summary").click();
	await inbox.getByRole("button", { name: new RegExp(title) }).click();
	await expect(p.locator(".issue-detail > .detail-heading h2")).toHaveText(
		title,
	);
}
async function refreshTask(p, title) {
	await p.getByRole("button", { name: "刷新任务", exact: true }).click();
	await task(p, title);
}
async function targetReady(p) {
	await expect(p.locator(".issue-target .canvas-message")).toHaveCount(0);
	await expect(
		p.locator(".issue-target .annotation-viewport canvas"),
	).toBeVisible();
}
async function createRequest(title) {
	await page.getByText("创建测量请求", { exact: true }).click();
	const form = page.locator(".measurement-create form");
	await form.getByLabel("请求题目", { exact: true }).fill(title);
	await form
		.getByLabel("目标信息", { exact: true })
		.fill("测量左侧孔位的内径，位置由蓝色线标记。");
	await form.getByLabel(/^建议测量方式/).selectOption("inside");
	await form
		.getByLabel("操作要求", { exact: true })
		.fill("手动测量；可只上传测量照片或说明无法测量。");
	await form.getByRole("button", { name: "保存测量请求", exact: true }).click();
	await expect(
		page.getByText("测量请求已创建，可在上方任务列表中查看。", { exact: true }),
	).toBeVisible();
	return requireData(await call(owner.request, `${O}/issues`)).items.find(
		(x) => x.title === title,
	);
}
try {
	await check(
		resume
			? "normal-password-login-resumes-saved-project-and-guest-session"
			: "normal-password-login-empty-project-create-share-guest-upload",
		async () => {
			await page.goto(`${root}/login`);
			await page.getByLabel("邮箱", { exact: true }).fill(accounts.A.email);
			await page.getByLabel(/^密码/).fill(accounts.A.password);
			await page.getByRole("button", { name: "登录", exact: true }).click();
			await page.waitForURL("**/projects");
			if (resume) {
				O = `/api/projects/${f.projectA}`;
				G = `/api/guest/projects/${f.projectA}`;
				await page.goto(`${root}/projects/${f.projectA}`);
				await guest.goto(f.shareUrl);
				await guest.waitForURL("**/s/session?project=*");
				return;
			}
			await page
				.getByLabel("项目名称", { exact: true })
				.fill(`P0-4 人工与浏览器闭环 ${f.stamp}`);
			await page.getByRole("button", { name: "创建项目", exact: true }).click();
			await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
			f.projectA = page.url().split("/").pop();
			O = `/api/projects/${f.projectA}`;
			G = `/api/guest/projects/${f.projectA}`;
			await page.getByText("项目说明与分享", { exact: true }).click();
			await page
				.getByRole("button", { name: "生成分享链接", exact: true })
				.click();
			const share = page.getByRole("textbox", { name: "新分享地址" });
			await expect(share).toBeVisible();
			f.shareUrl = await share.inputValue();
			await guest.goto(f.shareUrl);
			await guest.waitForURL("**/s/session?project=*");
			await shot(guest, "guest-empty-upload");
			await uploadInUi(
				guest,
				guest.getByRole("region", { name: "上传资料", exact: true }),
				[pngPath],
			);
		},
	);
	const title = `闭环 · 孔径数值 ${f.stamp}`;
	if (!resume)
		await check(
			"owner-draws-saves-annotation-and-fixed-measurement-request",
			async () => {
				active = page;
				await page.reload();
				await page.getByRole("button", { name: /manual-sample.png/ }).click();
				await expect(page.locator(".annotation-viewport canvas")).toBeVisible();
				await expect(page.locator(".canvas-message")).toHaveCount(0);
				await page.getByRole("button", { name: "线段", exact: true }).click();
				await page.locator(".annotation-viewport").scrollIntoViewIfNeeded();
				const view = await page
					.locator(".annotation-viewport")
					.evaluate((el) => {
						const r = el.getBoundingClientRect();
						return {
							x: r.x,
							y: r.y,
							px: +el.dataset.panX,
							py: +el.dataset.panY,
							s: +el.dataset.scale,
							w: +el.dataset.imageWidth,
							h: +el.dataset.imageHeight,
						};
					});
				const xy = (x, y) => ({
					x: view.x + view.px + x * view.w * view.s,
					y: view.y + view.py + y * view.h * view.s,
				});
				const a = xy(0.26, 0.45),
					b = xy(0.36, 0.45);
				await page.mouse.move(a.x, a.y);
				await page.mouse.down();
				await page.mouse.move(b.x, b.y, { steps: 10 });
				await page.mouse.up();
				await page.getByLabel("名称", { exact: true }).fill("左侧孔内径");
				await page
					.getByRole("button", { name: "保存标注", exact: true })
					.click();
				await expect(
					page.locator(".editor-status").getByRole("status").first(),
				).toHaveText("已保存");
				f.numeric = (await createRequest(title)).id;
				await shot(page, "owner-fixed-request");
			},
		);
	if (!deliveryOnly)
		await check(
			"guest-numeric-response-owner-confirmation-and-refresh-history",
			async () => {
				active = guest;
				await guest.reload();
				await task(guest, title);
				await targetReady(guest);
				await guest.getByLabel("测量数值", { exact: true }).fill("25.4");
				await guest.getByLabel(/^测量单位/).selectOption("mm");
				await guest
					.getByLabel("回复说明", { exact: true })
					.fill("合成流程验证，不是工程实测");
				await guest
					.getByRole("button", { name: "提交回复", exact: true })
					.click();
				await expect(guest.locator(".issue-state")).toContainText(
					"待工程师审核",
				);
				active = page;
				await refreshTask(page, title);
				const form = page.getByRole("form", { name: "工程师审核" });
				await form
					.getByRole("button", { name: "保存审核决定", exact: true })
					.click();
				await expect(page.locator(".issue-state")).toContainText("已确认");
				await page.reload();
				await task(page, title);
				const d = requireData(
					await call(owner.request, `${O}/issues/${f.numeric}`),
				);
				assert.equal(d.responses[0].value, "25.4");
				assert.equal(d.reviews[0].source, "customer_numeric");
			},
		);
	await check(
		"owner-private-multi-upload-draft-save-refresh-guest-invisible",
		async () => {
			active = page;
			await page
				.getByRole("button", { name: "交付与版本", exact: true })
				.click();
			const region = page.getByRole("region", { name: "交付草稿" });
			if (deliveryOnly) {
				await shot(page, "owner-processing-retry");
				const retry = region.getByRole("button", {
					name: "重试处理",
					exact: true,
				});
				while (await retry.count()) await retry.first().click();
				await expect(
					page.getByRole("checkbox", { name: /large-delivery.step/ }),
				).toBeVisible({ timeout: 240000 });
				await expect(
					page.getByRole("checkbox", { name: /manual-sample.png/ }),
				).toBeVisible({ timeout: 240000 });
			} else await uploadInUi(page, region, [stepPath, pngPath], true);
			await page
				.getByLabel("交付说明", { exact: true })
				.fill("第一轮成果：STEP附件与定位参考图。合成演示资料。");
			await page.getByRole("checkbox", { name: /large-delivery.step/ }).check();
			await page.getByRole("checkbox", { name: /manual-sample.png/ }).check();
			await page
				.getByRole("button", { name: "保存交付草稿", exact: true })
				.click();
			await expect(
				page.getByText("交付草稿已保存，仅工程师可见。", { exact: true }),
			).toBeVisible();
			await page.reload();
			await page
				.getByRole("button", { name: "交付与版本", exact: true })
				.click();
			await expect(page.getByLabel("交付说明", { exact: true })).toHaveValue(
				"第一轮成果：STEP附件与定位参考图。合成演示资料。",
			);
			await page
				.getByLabel("交付说明", { exact: true })
				.fill("第一轮成果：STEP附件与定位参考图。刷新后修订说明。");
			await page
				.getByRole("button", { name: "保存交付草稿", exact: true })
				.click();
			await expect(
				page.getByRole("heading", { name: /交付草稿.*修订 2/ }),
			).toBeVisible();
			const edited = requireData(await call(owner.request, `${O}/deliveries`))
				.drafts[0];
			assert.equal(edited.revision, 2);
			assert.equal(
				edited.description,
				"第一轮成果：STEP附件与定位参考图。刷新后修订说明。",
			);
			await shot(page, "owner-saved-draft");
			active = guest;
			await guest
				.getByRole("button", { name: "交付与版本", exact: true })
				.click();
			await expect(
				guest.getByText("尚无交付，工程师发布后可在这里下载。", {
					exact: true,
				}),
			).toBeVisible();
			assert.equal(
				requireData(await call(mobile.request, `${G}/deliveries`)).published,
				null,
			);
			await shot(guest, "guest-draft-invisible");
		},
	);
	await check(
		"owner-publishes-multiple-files-guest-range-download-real-bytes",
		async () => {
			active = page;
			await page
				.getByRole("button", { name: "确认发布成果", exact: true })
				.click();
			await expect(
				page.getByRole("heading", { name: "成果集合 V001", exact: true }),
			).toBeVisible();
			f.delivery = requireData(
				await call(owner.request, `${O}/deliveries`),
			).published.id;
			await shot(page, "owner-published");
			active = guest;
			await guest
				.getByRole("button", { name: "刷新交付", exact: true })
				.click();
			await expect(
				guest.getByRole("heading", { name: "成果集合 V001", exact: true }),
			).toBeVisible();
			const dl = guest.waitForEvent("download", { timeout: 240000 });
			await guest
				.getByRole("button", { name: "下载 large-delivery.step", exact: true })
				.click();
			const download = await dl;
			const path = await download.path();
			assert.equal(
				createHash("sha256")
					.update(await readFile(path))
					.digest("hex"),
				createHash("sha256").update(step).digest("hex"),
			);
			assert.equal(await download.failure(), null);
			await expect(
				guest.getByText("已交给浏览器保存，请检查下载列表。", { exact: true }),
			).toBeVisible();
			await shot(guest, "guest-download");
			await guest.reload();
			await guest
				.getByRole("button", { name: "交付与版本", exact: true })
				.click();
			await expect(
				guest.getByRole("heading", { name: "成果集合 V001", exact: true }),
			).toBeVisible();
			assert.equal(
				requireData(await call(mobile.request, `${G}/deliveries`)).published
					.files.length,
				2,
			);
		},
	);
	await check(
		"download-network-failure-actionable-retry-real-service",
		async () => {
			let fail = true;
			const pattern = "**/deliveries/*/files/*/download";
			await guest.route(pattern, async (route) => {
				if (fail) {
					fail = false;
					await route.abort("connectionreset");
				} else await route.continue();
			});
			await guest
				.getByRole("button", { name: "下载 large-delivery.step", exact: true })
				.click();
			await expect(
				guest.getByRole("button", {
					name: "重试下载 large-delivery.step",
					exact: true,
				}),
			).toBeVisible();
			const d = guest.waitForEvent("download", { timeout: 240000 });
			await guest
				.getByRole("button", {
					name: "重试下载 large-delivery.step",
					exact: true,
				})
				.click();
			const received = await d;
			assert.equal(
				createHash("sha256")
					.update(await readFile(await received.path()))
					.digest("hex"),
				createHash("sha256").update(step).digest("hex"),
			);
			await guest.unroute(pattern);
			assert.equal(fail, false);
		},
	);
} catch {
	/* Failed scenario already recorded, do not cascade dependent assertions. */
} finally {
	await writeFile("tmp/p0-4/browser-fixture.json", JSON.stringify(f));
	await writeFile(
		"tmp/p0-4/manual-entry.txt",
		`Engineer: ${root}/projects/${f.projectA}\nGuest (secret, do not commit): ${f.shareUrl}\nCredentials: tmp/p0-1/test-passwords.txt\nSample: tmp/p0-4/manual-sample.png\n`,
	);
	await owner.close();
	await mobile.close();
	await browser.close();
}
await writeFile(
	deliveryOnly
		? "docs/evidence/p0-4/browser-delivery.json"
		: resume
			? "docs/evidence/p0-4/browser-resume.json"
			: "docs/evidence/p0-4/browser.json",
	`${JSON.stringify({ checkedAt: new Date().toISOString(), root, https: root.startsWith("https:"), realAuthDatabaseStorage: true, physicalPhone: false, synthetic: true, downloadRetryFaultInjectionOnly: true, httpFailures, results }, null, 2)}\n`,
);
if (results.some((x) => x.status === "FAIL")) process.exitCode = 1;
