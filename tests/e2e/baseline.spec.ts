import { expect, test } from "@playwright/test";

test("public entry and liveness (not business readiness)", async ({
	page,
	request,
}) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"零件资料，清楚交接。",
	);
	await page.getByRole("link", { name: "工程师登录" }).click();
	await expect(page.getByRole("heading", { name: "工程师登录" })).toBeVisible();
	const health = await request.get("/api/health");
	expect(health.ok()).toBeTruthy();
	expect(health.headers()["cache-control"]).toContain("no-store");
	expect(health.headers()["referrer-policy"]).toBe("no-referrer");
	expect(await health.json()).toEqual({
		status: "ok",
		scope: "P0-1",
		database: "not-probed",
	});
});

test("registration is password plus numeric confirmation; invalid guest has no files", async ({
	page,
}) => {
	await page.goto("/login");
	await page.getByRole("button", { name: "没有账号？注册" }).click();
	await expect(
		page.getByRole("heading", { name: "创建工程师账号" }),
	).toBeVisible();
	await expect(page.getByLabel("密码", { exact: false })).toHaveAttribute(
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
	const read = await request.get("/api/projects");
	expect([401, 503]).toContain(read.status());
});
