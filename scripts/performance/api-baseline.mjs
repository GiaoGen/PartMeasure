// Real HTTP/Auth/PG, read-only apart from normal login. No browser, mocks, or DDL.
import { request } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "rvysclscetfqicpnzlra.supabase.co") throw Error("WRONG_PROJECT");
if (process.env.PM_NETWORK_MODE !== "direct") throw Error("DIRECT_WRAPPER_REQUIRED");
const label = process.argv[2] ?? "before";
if (!["before", "after"].includes(label)) throw Error("INVALID_LABEL");
const root = "http://127.0.0.1:3110";
const accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
const fixture = JSON.parse(await readFile("tmp/p0-4/fixture.json", "utf8"));
const results = [];
const clients = [];
const metrics = (header) => Object.fromEntries([
	...[...header.matchAll(/([a-z_]+);dur=([\d.]+)/g)].map((m) => [m[1], Number(m[2])]),
	...[...header.matchAll(/([a-z_]+)_count;desc="(\d+)"/g)].map((m) => [`${m[1]}_count`, Number(m[2])]),
]);
async function call(c, name, path, method = "GET", body) {
	const start = performance.now();
	try {
		const headers = {};
		if (method !== "GET") {
			const csrf = await (await c.get("/api/csrf")).json();
			Object.assign(headers, { origin: root, "x-csrf-token": csrf.data.token, "Idempotency-Key": randomUUID() });
		}
		const response = await c.fetch(path, { method, headers, ...(body === undefined ? {} : { data: body }) });
		const json = await response.json();
		results.push({ name, httpStatus: response.status(), elapsedMs: Math.round(performance.now() - start), timing: metrics(response.headers()["server-timing"] ?? ""), ...(json.error ? { error: json.error.code } : {}) });
		console.log(JSON.stringify(results.at(-1)));
		return json.data;
	} catch {
		results.push({ name, error: "HTTP_OR_DEPENDENCY_FAILED", elapsedMs: Math.round(performance.now() - start) });
	}
}
try {
	for (const actor of ["A", "B"]) {
		const c = await request.newContext({ baseURL: root, timeout: 20000 });
		clients.push(c);
		const login = await call(c, `${actor}_password_login`, "/api/auth/login", "POST", accounts[actor]);
		if (!login) continue;
		if (actor === "B") { await call(c, "B_cross_project_denied", `/api/projects/${fixture.projectA}/files`); continue; }
		for (let sample = 1; sample <= 3; sample++) {
			await call(c, `delivery_list_${sample}`, `/api/projects/${fixture.projectA}/deliveries`);
			await call(c, `file_list_${sample}`, `/api/projects/${fixture.projectA}/files`);
			const issues = await call(c, `issue_list_${sample}`, `/api/projects/${fixture.projectA}/issues`);
			if (sample === 1 && issues?.items[0]) await call(c, "issue_detail", `/api/projects/${fixture.projectA}/issues/${issues.items[0].id}`);
		}
	}
} finally {
	for (const c of clients) await c.dispose();
	await mkdir("docs/evidence/performance-s12", { recursive: true });
	await writeFile(`docs/evidence/performance-s12/api-${label}.json`, `${JSON.stringify({ checkedAt: new Date().toISOString(), networkMode: "direct-process-no-http-proxy", root, browserLaunched: false, realService: true, mainlandPhoneValidated: false, results }, null, 2)}\n`);
	await writeFile(`docs/evidence/performance-s12/api-${label}-${Date.now()}.json`, `${JSON.stringify({ checkedAt: new Date().toISOString(), networkMode: "direct-process-no-http-proxy", root, browserLaunched: false, realService: true, mainlandPhoneValidated: false, results }, null, 2)}\n`);
}
if (results.some((r) => r.name.includes("denied") ? r.httpStatus !== 404 : r.httpStatus !== 200)) process.exitCode = 1;
