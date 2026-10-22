// Read-only application smoke, not browser UX or network acceptance.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const root = process.argv[2], expectedBuild = process.argv[3];
const phase = process.argv[4] ?? "performance-inbox-20261022";
if (!/^[a-z0-9-]+$/.test(phase)) throw Error("INVALID_EVIDENCE_DIRECTORY");
if (!/^https:\/\/partmeasure-staging-[a-z0-9]+-messup-s-projects\.vercel\.app$/.test(root ?? "") || process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://rvysclscetfqicpnzlra.supabase.co") throw Error("ISOLATED_PREVIEW_ONLY");
const jar = new Map(), results = [];
let csrf;
async function raw(path, options = {}) {
	const response = await fetch(root + path, { ...options, headers: { cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...options.headers }, signal: AbortSignal.timeout(60000) });
	for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
	return response;
}
async function call(path, method = "GET", body) {
	if (method !== "GET" && !csrf) csrf = (await (await raw("/api/csrf")).json()).data.token;
	const response = await raw(path, { method, ...(method === "GET" ? {} : { body: JSON.stringify(body), headers: { origin: root, "Content-Type": "application/json", "x-csrf-token": csrf, "Idempotency-Key": randomUUID() } }) });
	const value = await response.json();
	if (!response.ok) throw Object.assign(Error(), { code: value.error?.code, status: response.status });
	return value.data;
}
try {
	assert.equal((await (await raw("/api/health")).json()).buildId, expectedBuild);
	results.push({ name: "exact_build_health", status: "PASS" });
	const account = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8")).A;
	const fixture = JSON.parse(await readFile("tmp/annotation-collaboration/fixture.json", "utf8"));
	await call("/api/auth/login", "POST", account);
	const base = `/api/projects/${fixture.projectId}`;
	const list = await call(`${base}/issues`);
	const selected = list.items.find(item => item.kind === "measurement" && item.annotationRef && !item.closedAt);
	assert.ok(selected);
	const ids = list.items.filter(item => item.fileId === selected.fileId && !item.closedAt).slice(0, 6).map(item => item.id);
	const views = await call(`${base}/issue-views?ids=${ids.join(",")}`);
	assert.equal(views.items.length, ids.length);
	assert.ok(views.items.every(item => item.view === "current" && item.fileId === selected.fileId));
	const single = await call(`${base}/issues/${selected.id}/current`);
	const batched = views.items.find(item => item.id === selected.id);
	assert.deepEqual(single.target, batched.target);
	assert.equal(single.revision, batched.revision);
	results.push({ name: "normal_login_same_file_bounded_current_views_fixed_snapshot", status: "PASS", count: ids.length });
	const bundle = await call(`${base}/inbox`);
	assert.ok(bundle.items.length);
	const item = bundle.items.find(item => item.id === selected.id);
	assert.ok(item);
	const snapshot = bundle.targets[item.targetKey];
	assert.deepEqual({ ...snapshot, image: bundle.images[item.fileId] }, single.target);
	assert.equal(item.revision, single.revision);
	assert.equal(bundle.files[item.fileId].id, single.fileId);
	const small = await call(`${base}/inbox?limit=2`);
	assert.ok(small.items.length <= 2);
	if (small.nextCursor) {
		const next = await call(`${base}/inbox?limit=2&cursor=${encodeURIComponent(small.nextCursor)}`);
		assert.ok(next.items.every(item => !small.items.some(old => old.id === item.id)));
	}
	const updated = await call(`${base}/inbox?ids=${selected.id}`);
	assert.equal(updated.items[0].revision, single.revision);
	results.push({ name: "inbox_complete_bundle_normalized_fixed_target_pagination_and_update", status: "PASS", count: bundle.items.length });
} catch (error) {
	results.push({ name: "preview_smoke", status: "FAIL", code: /^[A-Z0-9_]{2,50}$/.test(error.code ?? "") ? error.code : "ASSERTION_OR_DEPENDENCY", httpStatus: error.status });
	process.exitCode = 1;
} finally {
	const report = { checkedAt: new Date().toISOString(), url: root, buildId: expectedBuild, projectRef: "rvysclscetfqicpnzlra", scope: "Normal login and read-only current task JSON. No browser, UI or phone acceptance.", results };
	await writeFile(`docs/evidence/${phase}/preview.json`, `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report));
}
