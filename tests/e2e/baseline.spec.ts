import { expect, test } from "@playwright/test";

test("public entry and liveness (not business readiness)", async ({
	page,
	request,
}) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"把零件资料，交接清楚。",
	);
	await page.getByRole("link", { name: "工程师登录" }).click();
	await expect(page.getByRole("heading", { name: "工程师登录" })).toBeVisible();
	const health = await request.get("/api/health");
	expect(health.ok()).toBeTruthy();
	expect(health.headers()["cache-control"]).toContain("no-store");
	expect(health.headers()["referrer-policy"]).toBe("no-referrer");
	const healthBody = await health.json();
	expect(healthBody).toMatchObject({
		status: "ok",
		scope: "P0-1",
		database: "not-probed",
	});
	expect(healthBody.buildId).toMatch(/^p3-05-[a-f0-9]{20}$/);
});

test("registration is password plus numeric confirmation; invalid guest has no files", async ({
	page,
}) => {
	await page.goto("/login");
	await page.getByRole("button", { name: "没有账号？注册" }).click();
	await expect(
		page.getByRole("heading", { name: "创建工程师账号" }),
	).toBeVisible();
	await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute(
		"minlength",
		"12",
	);
	await page.goto("/s/invalid");
	await expect(
		page.getByRole("heading", { name: "链接已不可用" }),
	).toBeVisible();
	expect(await page.locator("input[type=file]").count()).toBe(0);
});

test("cross-origin writes and anonymous management are denied", async ({
	request,
}) => {
	const csrf = await request.get("/api/csrf");
	expect(csrf.headers()["cache-control"]).toContain("no-store");
	const refused = await request.post("/api/projects", {
		headers: { origin: "https://attacker.invalid" },
		data: { name: "forged" },
	});
	expect(refused.status()).toBe(403);
	expect((await refused.json()).error.code).toBe("ORIGIN_MISMATCH");
	const read = await request.get("/api/projects");
	expect(read.status()).toBe(401);
	expect((await read.json()).error.code).toBe("AUTH_REQUIRED");
});

test("native auth submission cannot put credentials in a URL before hydration", async ({ browser, baseURL }) => {
	if (!baseURL) throw new Error("BASE_URL_REQUIRED");
	const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
	let authRequests = 0;
	context.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/auth/")) authRequests++; });
	await context.route("**/login", route => route.request().method() === "POST"
		? route.fulfill({ contentType: "text/html", body: "<!doctype html><p>Native POST intercepted locally</p>" })
		: route.continue());
	try {
		const page = await context.newPage(); await page.goto("/login");
		await expect(page.locator(".pm-auth-form")).toHaveAttribute("method", "post");
		await page.locator('input[name="email"]').fill("synthetic-nojs@example.test");
		await page.locator('input[name="password"]').fill("synthetic-nojs-only-123");
		const submission = page.waitForRequest(request => request.isNavigationRequest() && request.method() === "POST");
		await page.locator('.pm-auth-form button[type="submit"]').click();
		const request = await submission;
		expect(new URL(request.url()).search).toBe("");
		expect(request.postData()).toContain("synthetic-nojs-only-123");
		expect(authRequests).toBe(0);
	} finally { await context.close(); }
});
