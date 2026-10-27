// Offline native-browser security regression; synthetic strings only, every request intercepted.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { AuthForm } from "../../src/components/auth-form";
const phase = process.argv[2]; assert.ok(phase === "before" || phase === "after");
const root = "http://127.0.0.1:39999/login";
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${renderToStaticMarkup(createElement(AuthForm))}</body></html>`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ javaScriptEnabled: false });
const requests: { method: string; queryContainsCredentials: boolean; bodyContainsSyntheticPassword: boolean }[] = [];
let documentRequests = 0;
await context.route("**/*", async route => {
	const request = route.request(), url = new URL(request.url());
	assert.equal(url.origin, "http://127.0.0.1:39999");
	if (!request.isNavigationRequest()) return route.fulfill({ status: 204, body: "" });
	documentRequests++;
	if (documentRequests > 1) requests.push({ method: request.method(), queryContainsCredentials: url.searchParams.has("password") || url.searchParams.has("email"), bodyContainsSyntheticPassword: request.postData()?.includes("synthetic-nojs-only-123") ?? false });
	await route.fulfill({ contentType: "text/html; charset=utf-8", body: documentRequests === 1 ? html : "<!doctype html><p>Intercepted locally</p>" });
});
try {
	const page = await context.newPage(); await page.goto(root);
	await page.locator('input[name="email"]').fill("synthetic-nojs@example.test");
	await page.locator('input[name="password"]').fill("synthetic-nojs-only-123");
	await Promise.all([page.waitForRequest(request => request.url().startsWith(root) && (request.url().includes("?") || request.method() === "POST")), page.locator('.pm-auth-form button[type="submit"]').click()]);
	const result = requests[0]; assert.ok(result);
	const passed = result.method === "POST" && !result.queryContainsCredentials && result.bodyContainsSyntheticPassword;
	const report = { checkedAt: new Date().toISOString(), phase, status: passed ? "PASS" : "VULNERABLE", browser: browser.version(), actualProductionComponent: true, JavaScriptEnabled: false, actualNetworkRequests: 0, realCredentialsUsed: false, requests };
	await writeFile(`docs/evidence/p3-05/auth-native-${phase}.json`, `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report));
	if (phase === "after") assert.ok(passed, "CREDENTIALS_MUST_NEVER_ENTER_URL_WITHOUT_HYDRATION");
} finally { await context.close(); await browser.close(); }
