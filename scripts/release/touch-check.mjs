// Browser-native touch/mouse regression of production canvas. No server/cloud/API.
import assert from "node:assert/strict";
import { build } from "esbuild";
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
const phase = process.argv[2]; assert.ok(["before", "after"].includes(phase));
const built = await build({ entryPoints: ["scripts/release/touch-fixture.tsx"], bundle: true, format: "iife", platform: "browser", write: false, outfile: "tmp/p3-05/touch.js", define: { "process.env.NODE_ENV": '"production"' }, jsx: "automatic" });
const js = built.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = built.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
const pixels = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#e7edf3" } }).webp().toBuffer();
const root = "http://127.0.0.1:39998";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [], pageErrors = [], requests = []; let blocked = 0;
async function scenario(tool, input) {
	const context = await browser.newContext({ viewport: { width: 420, height: 820 }, hasTouch: true, isMobile: true });
	await context.route("**/*", route => {
		const url = new URL(route.request().url());
		requests.push(url.pathname);
		assert.equal(url.origin, root); assert.equal(route.request().method(), "GET");
		if (url.pathname === "/touch-fixture") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\nbody{margin:0}.annotation-viewport{width:380px;height:400px;position:relative;touch-action:none}button{min-width:34px;min-height:34px}</style></head><body><div id="root"></div><script src="/touch.js"></script></body></html>` });
		if (url.pathname === "/touch.js") return route.fulfill({ contentType: "text/javascript", body: js });
		if (url.pathname === "/touch-pixels.webp") return route.fulfill({ contentType: "image/webp", headers: { "content-length": String(pixels.length) }, body: pixels });
		if (url.pathname === "/favicon.ico") return route.fulfill({ status: 204 });
		blocked++; return route.abort();
	});
	try {
		const page = await context.newPage(); page.on("pageerror", error => pageErrors.push(error.message));
		await page.goto(`${root}/touch-fixture`);
		await expect(page.locator(".annotation-viewport canvas").first()).toBeVisible();
		try { await expect(page.locator(".canvas-message")).toHaveCount(0); }
		catch { throw Error(`FIXTURE_IMAGE_NOT_READY: ${await page.locator(".canvas-message").innerText()}; requests=${requests.join(",")}`); }
		await page.evaluate(() => {
			window.touchEvents = [];
			for (const name of ["touchstart", "touchend", "mousedown", "mouseup", "click"])
				document.querySelector(".annotation-viewport").addEventListener(name, event => window.touchEvents.push({ type: event.type, fromTouch: event.sourceCapabilities?.firesTouchEvents ?? null }), true);
		});
		await page.getByRole("button", { name: tool === "angle" ? "角度" : "三点圆弧", exact: true }).click();
		const box = await page.locator(".konvajs-content").boundingBox(); assert.ok(box);
		const points = [{ x: box.x + 75, y: box.y + 250 }, { x: box.x + 190, y: box.y + 110 }, { x: box.x + 305, y: box.y + 250 }];
		const steps = [];
		for (const point of points) {
			if (input === "touch") await page.touchscreen.tap(point.x, point.y);
			else await page.mouse.click(point.x, point.y);
			await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
			steps.push({ count: JSON.parse(await page.locator("#created").innerText()).length, hint: await page.locator('[role="status"]').allTextContents() });
		}
		const geometries = JSON.parse(await page.locator("#created").innerText());
		const result = { tool, input, steps, geometries, events: await page.evaluate(() => window.touchEvents), status: "NOT_PASSED" };
		try {
			assert.deepEqual(steps.map(step => step.count), [0, 0, 1]);
			assert.equal(geometries[0].type, tool);
			const g = geometries[0], center = tool === "angle" ? g.vertex : g.via;
			assert.notDeepEqual(g.from, center); assert.notDeepEqual(center, g.to);
			result.status = "PASS";
		} catch { if (phase === "after") process.exitCode = 1; }
		results.push(result);
	} finally { await context.close(); }
}
async function otherGestures() {
	// Use the same isolated component/transport fixture for the shared touch handler.
	const context = await browser.newContext({ viewport: { width: 420, height: 820 }, hasTouch: true, isMobile: true });
	await context.route("**/*", route => {
		const url = new URL(route.request().url());
		assert.equal(url.origin, root); assert.equal(route.request().method(), "GET");
		if (url.pathname === "/touch-fixture") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\nbody{margin:0}.annotation-viewport{width:380px;height:400px;position:relative;touch-action:none}button{min-width:34px;min-height:34px}</style></head><body><div id="root"></div><script src="/touch.js"></script></body></html>` });
		if (url.pathname === "/touch.js") return route.fulfill({ contentType: "text/javascript", body: js });
		if (url.pathname === "/touch-pixels.webp") return route.fulfill({ contentType: "image/webp", body: pixels });
		if (url.pathname === "/favicon.ico") return route.fulfill({ status: 204 });
		blocked++; return route.abort();
	});
	try {
		for (const tool of ["line", "circle", "pan", "cancel-pinch"]) {
			const page = await context.newPage(); page.on("pageerror", error => pageErrors.push(error.message));
			await page.goto(`${root}/touch-fixture`);
			await expect(page.locator(".annotation-viewport canvas").first()).toBeVisible();
			await expect(page.locator(".canvas-message")).toHaveCount(0);
			const box = await page.locator(".konvajs-content").boundingBox(); assert.ok(box);
			const cdp = await context.newCDPSession(page);
			const point = (id, x, y) => ({ id, x: box.x + x, y: box.y + y, radiusX: 2, radiusY: 2, force: 1 });
			const start = point(1, 120, 160), end = point(1, 235, 245);
			const choose = name => page.getByRole("button", { name, exact: true }).click();
			await choose({ line: "线段", circle: "圆 / 孔位", pan: "平移", "cancel-pinch": "角度" }[tool]);
			const viewBefore = await page.locator(".annotation-viewport").getAttribute("data-pan-x");
			if (tool === "cancel-pinch") {
				await page.touchscreen.tap(box.x + 90, box.y + 250);
				await expect(page.getByText("第2点：角度顶点", { exact: false })).toBeVisible();
				await choose("取消"); await choose("角度");
				await page.touchscreen.tap(box.x + 90, box.y + 250);
				await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start, point(2, 250, 160)] });
				await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(1, 90, 160), point(2, 280, 160)] });
				await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
				await expect(page.getByText("第1点：第一端点", { exact: false })).toBeVisible();
				assert.deepEqual(JSON.parse(await page.locator("#created").innerText()), []);
			} else {
				await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
				await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [end] });
				await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
				const shapes = JSON.parse(await page.locator("#created").innerText());
				if (tool === "pan") {
					assert.deepEqual(shapes, []);
					assert.notEqual(await page.locator(".annotation-viewport").getAttribute("data-pan-x"), viewBefore);
				} else { assert.equal(shapes.length, 1); assert.equal(shapes[0].type, tool); }
			}
			results.push({ tool, input: "native-touch-gesture", status: "PASS" });
			await page.close();
		}
	} finally { await context.close(); }
}
try {
	for (const input of ["touch", "mouse"]) for (const tool of ["angle", "arc"]) await scenario(tool, input);
	if (phase === "after") await otherGestures();
} finally {
	const report = { checkedAt: new Date().toISOString(), phase, browser: browser.version(), scope: "Actual AnnotationCanvas/React-Konva/image-cache modules, native browser touchscreen and mouse events, synthetic local pixels, all requests intercepted. Not real phone, Auth or cloud evidence.", canvasSha256: createHash("sha256").update(await readFile("src/components/annotation-canvas.tsx")).digest("hex"), blocked, pageErrors, results };
	await writeFile(`docs/evidence/p3-05/touch-${phase}.json`, `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify({ phase, results: results.map(({ tool, input, status, steps }) => ({ tool, input, status, counts: steps?.map(s => s.count) })), pageErrors, blocked }));
	await browser.close(); if (blocked || pageErrors.length) process.exitCode = 1;
}
