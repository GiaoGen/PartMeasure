import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { request } from "@playwright/test";
const baseURL = "http://127.0.0.1:3000";
await mkdir("tmp/p0-1", { recursive: true });
await mkdir("docs/evidence/p0-1", { recursive: true });
const config = JSON.parse(await readFile("tmp/p0-0-cloud/config.json", "utf8"));
if (config.projectRef !== "rvysclscetfqicpnzlra")
	throw new Error("WRONG_TEST_PROJECT");
let accounts;
try {
	accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
} catch {
	accounts = Object.fromEntries(
		Object.entries(config.emails).map(([actor, email]) => [
			actor,
			{
				email: email.replace("@", "+p01@"),
				password: `Pm!${randomBytes(18).toString("base64url")}9a`,
			},
		]),
	);
	await writeFile("tmp/p0-1/test-accounts.json", JSON.stringify(accounts), {
		mode: 0o600,
	});
	await writeFile(
		"tmp/p0-1/test-passwords.txt",
		Object.entries(accounts)
			.map(([actor, a]) => `${actor}: ${a.email}\nPassword: ${a.password}\n`)
			.join("\n"),
		{ mode: 0o600 },
	);
}
const results = [];
for (const [actor, account] of Object.entries(accounts)) {
	const context = await request.newContext({ baseURL });
	try {
		const csrf = await (await context.get("/api/csrf")).json();
		const headers = { origin: baseURL, "x-csrf-token": csrf.data.token };
		if (process.argv[2] === "request") {
			let sent = false;
			try {
				sent = JSON.parse(
					await readFile(`tmp/p0-1/signup-${actor}.json`, "utf8"),
				).accepted;
			} catch {}
			if (sent) {
				results.push({ actor, step: "signup", status: "NOT_RESENT" });
				continue;
			}
			const result = await context.post("/api/auth/register", {
				headers,
				data: { email: account.email, password: account.password },
			});
			const json = await result.json();
			const accepted = result.ok() && json.data?.confirmationRequired === true;
			await writeFile(
				`tmp/p0-1/signup-${actor}.json`,
				JSON.stringify({ accepted }),
			);
			results.push({
				actor,
				step: "signup",
				status: accepted ? "EMAIL_REQUEST_ACCEPTED" : "FAIL",
				http: result.status(),
				code: json.error?.code ?? null,
			});
		} else {
			let otp = "";
			try {
				otp = (await readFile(`tmp/p0-1/otp-${actor}.txt`, "utf8")).trim();
			} catch {}
			if (!/^\d{6,10}$/.test(otp)) {
				results.push({ actor, step: "otp", status: "PENDING_INPUT" });
				continue;
			}
			const verified = await context.post("/api/auth/verify", {
				headers,
				data: { email: account.email, token: otp },
			});
			await rm(`tmp/p0-1/otp-${actor}.txt`, { force: true });
			const json = await verified.json();
			results.push({
				actor,
				step: "numeric-otp",
				status: verified.ok() ? "PASS" : "FAIL",
				http: verified.status(),
				code: json.error?.code ?? null,
			});
			if (!verified.ok()) continue;
			const session = await context.get("/api/auth/session");
			results.push({
				actor,
				step: "otp-session",
				status: session.ok() ? "PASS" : "FAIL",
			});
			const logout = await context.post("/api/auth/logout", {
				headers,
				data: {},
			});
			results.push({
				actor,
				step: "logout",
				status: logout.ok() ? "PASS" : "FAIL",
			});
			const refused = await context.get("/api/auth/session");
			results.push({
				actor,
				step: "logged-out-denied",
				status: refused.status() === 401 ? "PASS" : "FAIL",
			});
			const loggedIn = await context.post("/api/auth/login", {
				headers,
				data: { email: account.email, password: account.password },
			});
			results.push({
				actor,
				step: "password-login",
				status: loggedIn.ok() ? "PASS" : "FAIL",
			});
			if (!loggedIn.ok()) continue;
			await context.storageState({ path: `tmp/p0-1/owner-${actor}.json` });
			const restored = await request.newContext({
				baseURL,
				storageState: `tmp/p0-1/owner-${actor}.json`,
			});
			results.push({
				actor,
				step: "new-context-session-restore",
				status: (await restored.get("/api/auth/session")).ok()
					? "PASS"
					: "FAIL",
			});
			await restored.dispose();
		}
	} catch {
		results.push({
			actor,
			step: process.argv[2],
			status: "FAIL",
			code: "REDACTED_NETWORK_OR_SERVICE_ERROR",
		});
	} finally {
		await context.dispose();
	}
}
await writeFile(
	`docs/evidence/p0-1/auth-${process.argv[2]}.json`,
	`${JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(results)}\n`);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
