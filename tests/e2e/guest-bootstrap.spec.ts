import { expect, test } from "@playwright/test";

// Actual built application with synthetic responses only; never creates a cloud Guest.
for (const sample of [
	{ name: "revoked share", status: 401, code: "LINK_UNAVAILABLE", denied: true },
	{ name: "provider outage", status: 503, code: "DEPENDENCY_UNAVAILABLE", denied: false },
	{ name: "unrelated unauthorized response", status: 401, code: "AUTH_REQUIRED", denied: false },
	{ name: "network failure", status: 0, code: "", denied: false },
]) {
	test(`raw share landing distinguishes ${sample.name}`, async ({ page }) => {
		let attempts = 0;
		const synthetic = "A".repeat(43);
		await page.route("**/api/**", async route => {
			const path = new URL(route.request().url()).pathname;
			if (path === "/api/csrf") return route.fulfill({ json: { data: { token: "C".repeat(43) } } });
			if (path !== "/api/guest/session") throw new Error("UNEXPECTED_REAL_API_REQUEST");
			attempts++;
			expect(route.request().postDataJSON()).toEqual({ token: synthetic });
			if (sample.status === 0) return route.abort("failed");
			return route.fulfill({ status: sample.status, json: { error: { code: sample.code } } });
		});
		await page.goto(`/s/${synthetic}`);
		await expect(page.getByRole("heading", {
			name: sample.denied ? "链接已不可用" : "暂时无法打开项目",
		})).toBeVisible();
		await expect(page).toHaveURL(/\/s\/session$/);
		if (!sample.denied) await expect(page.getByRole("heading", { name: "链接已不可用" })).toHaveCount(0);
		expect(attempts).toBe(1);
		expect(await page.locator("input[type=file]").count()).toBe(0);
	});
}

test("successful raw share bootstrap keeps its normal session navigation", async ({ page }) => {
	const projectId = "98493feb-2b6f-4454-81ae-7960e84efff8";
	let attempts = 0;
	await page.route("**/api/**", async route => {
		const path = new URL(route.request().url()).pathname;
		if (path === "/api/csrf") return route.fulfill({ json: { data: { token: "C".repeat(43) } } });
		if (path !== "/api/guest/session") throw new Error("UNEXPECTED_REAL_API_REQUEST");
		attempts++;
		return route.fulfill({ json: { data: { projectId } } });
	});
	await page.route(`**/s/session?project=${projectId}`, route => route.fulfill({
		contentType: "text/html", body: "<!doctype html><p>Intercepted session landing</p>",
	}));
	await page.goto(`/s/${"A".repeat(43)}`);
	await expect(page).toHaveURL(new RegExp(`/s/session\\?project=${projectId}$`));
	await expect(page.getByText("Intercepted session landing")).toBeVisible();
	expect(attempts).toBe(1);
});
