// Explicit user authorization: admin-created fixtures, NOT numeric OTP acceptance.
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { request } from "@playwright/test";
const config = JSON.parse(await readFile("tmp/p0-0-cloud/config.json", "utf8"));
if (config.projectRef !== "rvysclscetfqicpnzlra")
	throw new Error("WRONG_TEST_PROJECT");
const secret = (await readFile("tmp/p0-1/secret-key.txt", "utf8")).trim();
const accounts = JSON.parse(
	await readFile("tmp/p0-1/test-accounts.json", "utf8"),
);
const admin = createClient(config.url, secret, {
	auth: { persistSession: false, autoRefreshToken: false },
});
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
const results = [];
for (const [actor, account] of Object.entries(accounts)) {
	const existing = listed.data?.users.find((u) => u.email === account.email);
	const result = existing
		? await admin.auth.admin.updateUserById(existing.id, {
				password: account.password,
				email_confirm: true,
			})
		: await admin.auth.admin.createUser({
				email: account.email,
				password: account.password,
				email_confirm: true,
			});
	if (result.error) {
		results.push({
			actor,
			step: "admin-fixture",
			status: "FAIL",
			code: result.error.code ?? "ADMIN_ERROR",
		});
		continue;
	}
	results.push({ actor, step: "admin-fixture-not-otp", status: "CREATED" });
	const context = await request.newContext({
		baseURL: "http://127.0.0.1:3000",
	});
	try {
		const csrf = await (await context.get("/api/csrf")).json();
		const headers = {
			origin: "http://127.0.0.1:3000",
			"x-csrf-token": csrf.data.token,
		};
		const login = await context.post("/api/auth/login", {
			headers,
			data: { email: account.email, password: account.password },
		});
		results.push({
			actor,
			step: "real-password-login",
			status: login.ok() ? "PASS" : "FAIL",
			http: login.status(),
		});
		if (login.ok()) {
			await context.storageState({ path: `tmp/p0-1/owner-${actor}.json` });
			const fresh = await request.newContext({
				baseURL: "http://127.0.0.1:3000",
				storageState: `tmp/p0-1/owner-${actor}.json`,
			});
			results.push({
				actor,
				step: "fresh-context-session-restore",
				status: (await fresh.get("/api/auth/session")).ok() ? "PASS" : "FAIL",
			});
			await fresh.dispose();
		}
	} catch {
		results.push({ actor, step: "fixture-login", status: "FAIL" });
	} finally {
		await context.dispose();
	}
}
results.push({
	step: "numeric-otp-registration",
	status: "PENDING_USER_DEFERRED",
});
await writeFile(
	"docs/evidence/p0-1/auth-fixtures.json",
	`${JSON.stringify({ checkedAt: new Date().toISOString(), adminFixtures: true, results }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(results)}\n`);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
