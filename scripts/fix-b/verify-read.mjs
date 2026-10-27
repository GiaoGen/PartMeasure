// Current local app + real existing test accounts; GET metadata only after normal password login.
// No browser, mail, registration, Guest bootstrap, business data writes or cleanup.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const root = "http://127.0.0.1:3000", ref = "rvysclscetfqicpnzlra";
if (process.env.APP_URL !== root || new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin !== `https://${ref}.supabase.co`) throw Error("ISOLATED_LOOPBACK_ONLY");
const paths = ["src/lib/file-metadata.ts", "src/lib/server/service.ts", "src/app/api/[...segments]/route.ts", "src/components/workspace.tsx", "src/components/workspace-history.ts", "src/components/history-position.ts", "src/components/application-history.tsx", "src/app/layout.tsx", "package-lock.json"];
const source = [];
for (const path of paths) source.push({ path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
const accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
const old = JSON.parse(await readFile("tmp/p0-4/fixture.json", "utf8"));
const fresh = JSON.parse(await readFile("tmp/fix-a/29ad04d2-6adc-4a14-88c2-5987fc27200d.json", "utf8"));
const results = [];
function client() {
	const jar = new Map(); let csrf;
	async function call(path, method = "GET", body) {
		if (method !== "GET" && !csrf) csrf = (await call("/api/csrf")).data.token;
		const response = await fetch(root + path, { method, redirect: "error", signal: AbortSignal.timeout(45000),
			headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(method === "GET" ? {} : { origin: root, "x-csrf-token": csrf, "Content-Type": "application/json" }) },
			...(body ? { body: JSON.stringify(body) } : {}),
		});
		for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
		const json = await response.json();
		return { status: response.status, data: json.data, cache: response.headers.get("cache-control") };
	}
	return { call, clear: () => jar.clear() };
}
const A = client(), B = client(), anonymous = client();
let stage = "setup";
async function check(name, work) {
	stage = name; const start = performance.now();
	try { await work(); results.push({ name, status: "PASS", milliseconds: Math.round(performance.now() - start) }); }
	catch (error) { results.push({ name, status: "NOT_PASSED", milliseconds: Math.round(performance.now() - start), errorClass: ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET"].includes(error.cause?.code) ? error.cause.code : "HTTP_OR_ASSERTION_FAILED" }); throw error; }
	console.log(JSON.stringify(results.at(-1)));
}
try {
	await check("normal_owner_a_login", async () => assert.equal((await A.call("/api/auth/login", "POST", accounts.A)).status, 200));
	await check("single_photo_attachment_and_private_attachment_exact_metadata_projection", async () => {
		for (const [project, file] of [[old.projectA, old.material.id], [old.projectA, old.file1.id], [fresh.projectId, fresh.fileId]]) {
			const response = await A.call(`/api/projects/${project}/files/${file}`);
			assert.equal(response.status, 200); assert.equal(response.data.id, file);
			assert.equal(response.cache, "private, no-store");
			assert.deepEqual(Object.keys(response.data).sort(), ["id", "filename", "mime", "extension", "byteSize", "uploaderType", "createdAt"].sort());
			assert.ok(response.data.filename && !response.data.filename.includes("链接定位"));
		}
	});
	await check("normal_owner_b_login", async () => assert.equal((await B.call("/api/auth/login", "POST", accounts.B)).status, 200));
	await check("other_owner_and_unauthenticated_metadata_denied", async () => {
		const path = `/api/projects/${fresh.projectId}/files/${fresh.fileId}`;
		assert.equal((await B.call(path)).status, 404);
		assert.equal((await anonymous.call(path)).status, 401);
	});
	await check("wrong_project_and_list_query_cannot_change_metadata_scope", async () => {
		assert.equal((await A.call(`/api/projects/${old.projectA}/files/${fresh.fileId}`)).status, 404);
		assert.equal((await A.call(`/api/projects/${fresh.projectId}/files/${fresh.fileId}?purpose=material`)).status, 422);
	});
	await check("relevant_source_unchanged_during_run", async () => {
		for (const file of source) assert.equal(createHash("sha256").update(await readFile(file.path)).digest("hex"), file.sha256);
	});
} catch {
	if (!results.some(result => result.status === "NOT_PASSED")) results.push({ name: stage, status: "NOT_PASSED", code: "SETUP_FAILED" });
	process.exitCode = 1;
} finally {
	A.clear(); B.clear(); anonymous.clear();
	await mkdir("docs/evidence/fix-b", { recursive: true });
	await writeFile("docs/evidence/fix-b/real-metadata-read.json", `${JSON.stringify({ checkedAt: new Date().toISOString(), scope: "Current local development HTTP + existing real test accounts/isolated DB. No browser/Guest bootstrap/data writes/phone acceptance; normal login/Auth sessions and API rate counters retain their normal side effects.", source, results }, null, 2)}\n`);
}
