// Runs the actual UI API module against real HTTP with a process-local cookie jar.
// The jar supplies browser cookie/origin transport only; no responses are mocked.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { api, clearApiSession } from "../../src/components/api.ts";

if (process.env.PM_NETWORK_MODE !== "direct" || new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "rvysclscetfqicpnzlra.supabase.co") throw Error("WRONG_TEST_MODE");
const root = "http://127.0.0.1:3110";
const accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
const nativeFetch = globalThis.fetch;
const jar = new Map(), counts = { csrf: 0, read: 0, write: 0 }, results = [];
globalThis.fetch = async (url, init = {}) => {
	if (typeof url !== "string" || !url.startsWith("/api/")) throw Error("INVALID_LOCAL_PATH");
	if (url === "/api/csrf") counts.csrf++;
	else if ((init.method ?? "GET") === "GET") counts.read++;
	else counts.write++;
	const headers = new Headers(init.headers);
	headers.set("Cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
	if (init.method && init.method !== "GET") headers.set("Origin", root);
	const response = await nativeFetch(`${root}${url}`, { ...init, headers });
	for (const cookie of response.headers.getSetCookie()) {
		const pair = cookie.split(";")[0], equal = pair.indexOf("="), key = pair.slice(0, equal), value = pair.slice(equal + 1);
		if (!value || /max-age=0(?:;|$)/i.test(cookie)) jar.delete(key); else jar.set(key, value);
	}
	return response;
};
async function check(name, work) {
	try { await work(); results.push({ name, status: "PASS" }); }
	catch (e) { results.push({ name, status: "FAIL", code: /^[A-Z0-9_]+$/.test(e.code ?? "") ? e.code : "ASSERTION_OR_DEPENDENCY_FAILED", ...(Number.isInteger(e.status) ? { httpStatus: e.status } : {}) }); }
	console.log(JSON.stringify(results.at(-1)));
}
try {
	await api("/api/auth/login", "POST", accounts.A);
	const project = await api("/api/projects", "POST", { name: `PERF-S12-CLIENT-${Date.now()}`, description: "真实API客户端缓存验证" });
	await check("one-csrf-fetch-for-login-and-following-write", async () => { assert.equal(counts.csrf, 1); });
	const path = `/api/projects/${project.id}`;
	await check("simultaneous-real-reads-share-one-http-and-retained-read-adds-none", async () => {
		const before = counts.read;
		const [a, b] = await Promise.all([api(path, "GET", undefined, { cacheMs: 1000 }), api(path, "GET", undefined, { cacheMs: 1000 })]);
		assert.equal(a.id, project.id); assert.deepEqual(a, b);
		await api(path, "GET", undefined, { cacheMs: 1000 });
		assert.equal(counts.read - before, 1);
	});
	await check("mutation-response-and-cache-invalidation", async () => {
		const updated = await api(path, "PATCH", { name: project.name, description: "已真实更新" }, { revision: project.revision });
		assert.equal(updated.revision, project.revision + 1);
		const before = counts.read;
		const restored = await api(path, "GET", undefined, { cacheMs: 1000 });
		assert.equal(counts.read - before, 1); assert.equal(restored.description, updated.description);
		assert.equal(counts.csrf, 1);
	});
	await check("account-switch-cannot-reuse-owner-a-cache", async () => {
		await api("/api/auth/login", "POST", accounts.B);
		await assert.rejects(() => api(path, "GET", undefined, { cacheMs: 1000 }), error => error.status === 404);
		assert.equal(counts.csrf, 2);
	});
} catch (e) { results.push({ name: "dependent-client-checks", status: "FAIL", code: /^[A-Z0-9_]+$/.test(e.code ?? "") ? e.code : "DEPENDENCY_UNAVAILABLE", ...(Number.isInteger(e.status) ? { httpStatus: e.status } : {}) }); }
finally {
	globalThis.fetch = nativeFetch; clearApiSession(); jar.clear();
	await mkdir("docs/evidence/performance-s12", { recursive: true });
	await writeFile("docs/evidence/performance-s12/client.json", `${JSON.stringify({ checkedAt: new Date().toISOString(), realService: true, actualApiModule: true, browserLaunched: false, mainlandPhoneValidated: false, networkMode: "direct-process-no-http-proxy", counts, results }, null, 2)}\n`);
	await writeFile(`docs/evidence/performance-s12/client-${Date.now()}.json`, `${JSON.stringify({ checkedAt: new Date().toISOString(), realService: true, actualApiModule: true, browserLaunched: false, mainlandPhoneValidated: false, networkMode: "direct-process-no-http-proxy", counts, results }, null, 2)}\n`);
}
if (!results.length || results.some(r => r.status !== "PASS")) process.exitCode = 1;
