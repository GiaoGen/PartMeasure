// HTTP/API + SSR regression only: no browser, administrative login or remote DDL.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { api, clearApiSession } from "../../src/components/api.ts";
const root = "http://127.0.0.1:3120";
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "rvysclscetfqicpnzlra.supabase.co" || process.env.PM_NETWORK_MODE !== "direct")
	throw Error("WRONG_ISOLATED_TEST");
const accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
const nativeFetch = globalThis.fetch, jar = new Map(), results = [];
const prefix = `FIX-PROJECT-${Date.now()}`;
let origin = "http://localhost:3120";
globalThis.fetch = async (url, init = {}) => {
	if (typeof url !== "string" || !url.startsWith("/api/")) throw Error("WRONG_API_PATH");
	const headers = new Headers(init.headers);
	headers.set("Cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
	if (init.method && init.method !== "GET") {
		headers.set("Origin", origin);
		headers.set("Sec-Fetch-Site", "same-origin");
	}
	const res = await nativeFetch(root + url, { ...init, headers });
	for (const cookie of res.headers.getSetCookie()) {
		const pair = cookie.split(";")[0], i = pair.indexOf("="), k = pair.slice(0, i), v = pair.slice(i + 1);
		if (!v || /max-age=0(?:;|$)/i.test(cookie)) jar.delete(k); else jar.set(k, v);
	}
	return res;
};
const cookieHeaders = () => ({ Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") });
async function check(name, work) {
	try { await work(); results.push({ name, status: "PASS" }); }
	catch (e) { results.push({ name, status: "FAIL", code: /^[A-Z0-9_]+$/.test(e.code ?? "") ? e.code : "ASSERTION_OR_DEPENDENCY_FAILED", ...(Number.isInteger(e.status) ? { httpStatus: e.status } : {}) }); }
	console.log(JSON.stringify(results.at(-1)));
}
let folder, project;
try {
	await check("localhost-origin-normal-password-login-folder-and-project-create", async () => {
		await api("/api/auth/login", "POST", accounts.A);
		const input = { name: prefix, description: "文件夹持久化回归", color: "blue" };
		const key = randomUUID();
		folder = await api("/api/project-folders", "POST", input, { key });
		const replay = await api("/api/project-folders", "POST", input, { key });
		assert.equal(replay.id, folder.id);
		project = await api("/api/projects", "POST", { name: prefix, description: "正常创建与刷新恢复", folderId: folder.id });
		assert.equal(project.folderId, folder.id);
	});
	await check("fresh-normal-login-restores-folder-membership-and-server-rendered-page", async () => {
		assert.ok(folder && project);
		clearApiSession(); jar.clear(); origin = root;
		await api("/api/auth/login", "POST", accounts.A);
		const folders = await api("/api/project-folders");
		assert.ok(folders.items.some((x) => x.id === folder.id));
		const projects = await api(`/api/projects?folderId=${folder.id}`);
		assert.ok(projects.items.some((x) => x.id === project.id && x.folderId === folder.id));
		const page = await nativeFetch(`${root}/projects`, { headers: cookieHeaders(), redirect: "manual", signal: AbortSignal.timeout(45000) });
		assert.equal(page.status, 200);
		assert.ok((await page.text()).includes(prefix));
	});
	await check("untrusted-origin-still-rejected-before-business-write", async () => {
		origin = "http://attacker.invalid:3120";
		await assert.rejects(() => api("/api/projects", "POST", { name: prefix, description: "" }), (e) => e.status === 403 && e.code === "ORIGIN_MISMATCH");
	});
	await check("account-B-cannot-list-or-use-account-A-folder", async () => {
		assert.ok(folder && project);
		origin = root;
		await api("/api/auth/login", "POST", accounts.B);
		const folders = await api("/api/project-folders");
		assert.ok(!folders.items.some((x) => x.id === folder.id));
		await assert.rejects(() => api("/api/projects", "POST", { name: prefix, description: "", folderId: folder.id }), (e) => e.status === 404);
		await assert.rejects(() => api(`/api/projects/${project.id}`), (e) => e.status === 404);
	});
} finally {
	globalThis.fetch = nativeFetch;
	clearApiSession();
	await mkdir("docs/evidence/project-create-fix", { recursive: true });
	await writeFile("docs/evidence/project-create-fix/http.json", `${JSON.stringify({ checkedAt: new Date().toISOString(), scope: "Local production Next + normal password + real isolated DB; no browser", results }, null, 2)}\n`);
}
if (results.some((r) => r.status !== "PASS")) process.exitCode = 1;
