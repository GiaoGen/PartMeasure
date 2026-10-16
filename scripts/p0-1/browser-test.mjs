import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, devices } from "@playwright/test";
import sharp from "sharp";
import {randomUUID, randomBytes} from 'node:crypto';
const baseURL = "http://127.0.0.1:3000",
	results = [];
await mkdir("docs/evidence/p0-1/screenshots", { recursive: true });
const fixture = JSON.parse(
	await readFile("tmp/p0-1/business-fixtures.json", "utf8"),
);
const proxy = process.env.HTTPS_PROXY
	? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" }
	: undefined;
const browser = await chromium.launch({
	headless: true,
	...(proxy ? { proxy } : {}),
});
const contexts = [];
async function step(name, work) {
	try {
		await work();
		results.push({ check: name, status: "PASS" });
	} catch (error) {
		const current = contexts.at(-1)?.pages().at(-1);
		const screen = current
			? await current
					.locator("h1")
					.allTextContents()
					.catch(() => [])
			: [];
		results.push({
			check: name,
			status: "FAIL",
			errorType: error.name,
			screen,
		});
		if (current)
			await current
				.screenshot({
					path: `docs/evidence/p0-1/screenshots/failure-${name}.png`,
					fullPage: true,
					mask: [
						current.locator(
							'input[type=password],input[type=email],input[aria-label="新分享地址"]',
						),
					],
				})
				.catch(() => {});
	}
	process.stdout.write(`${name}: ${results.at(-1).status}\n`);
}
async function shot(page, name) {
	await page.screenshot({
		path: `docs/evidence/p0-1/screenshots/${name}.png`,
		fullPage: true,
	});
}
try {
	const owner = await browser.newContext({
		viewport: { width: 1440, height: 1000 },
		storageState: "tmp/p0-1/owner-A.json",
	});
	contexts.push(owner);
	const page = await owner.newPage();
	await step("owner-SSR-page-and-browser-reload", async () => {
		await page.goto(`${baseURL}/projects/${fixture.projectA}`);
		await page
			.getByRole("heading", { name: "安装板 · P0-1 验证", exact: true })
			.waitFor();
		await page.reload();
		await page
			.getByRole("heading", { name: "安装板 · P0-1 验证", exact: true })
			.waitFor();
		await page.getByRole("button", { name: /plate.jpg/ }).click();
		await page.locator(".image-viewport img").waitFor();
		await page.waitForFunction(
			() => document.querySelector(".image-viewport img")?.naturalWidth > 0,
		);
		await shot(page, "engineer-desktop");
	});
	await step("two-sections-and-honest-delivery-placeholder", async () => {
		assert.equal(await page.locator(".section-nav button").count(), 2);
		await page.getByRole("button", { name: "交付与版本", exact: true }).click();
		await page.getByRole("heading", { name: "尚无交付" }).waitFor();
		await page.getByRole("button", { name: "返回资料与补测" }).click();
	});
	await step("project-create-through-UI-and-mobile-empty-upload", async () => {
		await page.goto(`${baseURL}/projects`);
		await page
			.getByLabel("项目名称", { exact: true })
			.fill("空项目 · 客户上传");
		await page.getByLabel("项目说明（可选）").fill("请先上传零件正反面照片。");
		await shot(page, "projects-desktop");
		await page.getByRole("button", { name: "创建项目", exact: true }).click();
		await page
			.getByRole("heading", { name: "空项目 · 客户上传", exact: true })
			.waitFor();
		await page.getByText("项目说明与分享", { exact: true }).click();
		await page
			.getByRole("button", { name: "生成分享链接", exact: true })
			.click();
		await page.getByLabel("新分享地址").waitFor();
		const link = await page.getByLabel("新分享地址").inputValue();
		await page.getByText("项目说明与分享", { exact: true }).click();
		const guest = await browser.newContext({ ...devices["Pixel 7"] });
		contexts.push(guest);
		const mobile = await guest.newPage();
		await mobile.goto(link);
		await mobile.waitForURL("**/s/session?project=*");
		await mobile
			.getByRole("heading", { name: "空项目 · 客户上传", exact: true })
			.waitFor();
		await mobile.getByLabel("选择上传文件").waitFor();
		assert.ok(!(await guest.cookies()).some((c) => c.name.startsWith("sb-")));
		await mobile.getByText(/还没有可查看资料/).waitFor();
		await shot(mobile, "guest-mobile-empty");
		await mobile.reload();
		await mobile.getByLabel("选择上传文件").waitFor();
	});
	const guest = await browser.newContext({
		...devices["Pixel 7"],
	});
	contexts.push(guest);
	const mobile = await guest.newPage();
	await step(
		"guest-existing-files-and-preview-on-mobile-viewport",
		async () => {
			// Establish a matching anonymous session from the snapshotted capability,
			// never pair a fixture with a mutable state file from another suite.
			await mobile.goto(fixture.shareUrl);
			await mobile.waitForURL("**/s/session?project=*",{timeout:60000});
			await mobile.getByRole("button", { name: /plate.jpg/ }).click();
			await mobile.locator(".image-viewport img").waitFor();
			await mobile.waitForFunction(
				() => document.querySelector(".image-viewport img")?.naturalWidth > 0,
			);
			await shot(mobile, "guest-mobile-files");
		},
	);
	await step(
		"real-browser-batch-partial-failure-and-individual-retry",
		async () => {
			const color=randomBytes(3);
			const png = await sharp({
				create: {
					width: 64,
					height: 48,
					channels: 3,
					background: { r: color[0], g: color[1], b: color[2] },
				},
			})
				.png()
				.toBuffer();
			await mobile.getByLabel("选择上传文件").setInputFiles([
				{ name: "partial-success.png", mimeType: "image/png", buffer: png },
				{
					name: "unsupported.heic",
					mimeType: "image/heic",
					buffer: Buffer.from("not allowed"),
				},
			]);
			const success = mobile
					.locator(".queue li")
					.filter({ hasText: "partial-success.png" }),
				bad = mobile
					.locator(".queue li")
					.filter({ hasText: "unsupported.heic" });
			await success
				.getByText("已完成 · 工程师和客户可查看", { exact: true })
				.waitFor({ timeout: 120000 });
			await bad.getByRole("button", { name: "重试此文件" }).waitFor();
			await bad.getByRole("button", { name: "重试此文件" }).click();
			await bad.getByRole("button", { name: "重试此文件" }).waitFor();
			assert.equal(
				await success
					.getByText("已完成 · 工程师和客户可查看", { exact: true })
					.count(),
				1,
			);
			await shot(mobile, "guest-mobile-partial-failure");
		},
	);
	await step(
		"guest-attachment-upload-download-retest-after-lock-grant",
		async () => {
			const attachmentName=`browser-attachment-${randomUUID().slice(0,8)}.step`;
			const bytes = Buffer.from(
				`ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('browser attachment ${randomUUID()}'), '2;1');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;`,
			);
			await mobile.getByLabel("选择上传文件").setInputFiles({
				name: attachmentName,
				mimeType: "application/octet-stream",
				buffer: bytes,
			});
			await mobile
				.locator(".queue li")
				.filter({ hasText: attachmentName })
				.getByText("已完成 · 工程师和客户可查看", { exact: true })
				.waitFor({ timeout: 120000 });
			await mobile
				.getByRole("button").filter({hasText:attachmentName})
				.click();
			const downloaded = mobile.waitForEvent("download");
			await mobile.getByRole("link", { name: "下载附件", exact: true }).click();
			const file = await downloaded;
			const saved = await file.path();
			assert.deepEqual(await readFile(saved), bytes);
		},
	);
	await step("real-browser-TUS-above-6MiB", async () => {
		const triangles = 150000,
			stl = Buffer.alloc(84 + triangles * 50);
		stl.write("PartMeasure bounded binary STL fixture", 0);
		stl.write(randomUUID(),40);
		stl.writeUInt32LE(triangles, 80);
		await mobile.getByLabel("选择上传文件").setInputFiles({
			name: "resumable-part.stl",
			mimeType: "application/octet-stream",
			buffer: stl,
		});
		await mobile
			.locator(".queue li")
			.filter({ hasText: "resumable-part.stl" })
			.getByText("已完成 · 工程师和客户可查看", { exact: true })
			.waitFor({ timeout: 300000 });
	});
	const publicContext = await browser.newContext({ ...devices["Pixel 7"] });
	contexts.push(publicContext);
	const publicPage = await publicContext.newPage();
	await step("login-registration-and-invalid-link-screens", async () => {
		await publicPage.goto(`${baseURL}/login`);
		await shot(publicPage, "login-mobile");
		await publicPage.getByRole("button", { name: "没有账号？注册" }).click();
		await shot(publicPage, "registration-mobile");
		await publicPage.goto(`${baseURL}/s/invalid`);
		await publicPage.getByRole("heading", { name: "链接已不可用" }).waitFor();
		await shot(publicPage, "invalid-link-mobile");
	});
} finally {
	for (const context of contexts) await context.close();
	await browser.close();
}
await writeFile(
	"docs/evidence/p0-1/browser-business.json",
	`${JSON.stringify({ checkedAt: new Date().toISOString(), browser: "Chromium desktop + Pixel7 viewport; NOT physical phone", traces: false, results }, null, 2)}\n`,
);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
