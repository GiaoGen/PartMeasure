// Read-only metadata/image/SSE smoke against the already verified non-production deployment.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
const root = process.argv[2], expectedBuild = process.argv[3];
if (!/^https:\/\/partmeasure-staging-[a-z0-9]+-messup-s-projects\.vercel\.app$/.test(root ?? "") || process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://rvysclscetfqicpnzlra.supabase.co" || process.env.PM_NETWORK_MODE !== "direct") throw Error("VERIFIED_PREVIEW_ONLY");
const fixture = JSON.parse(await readFile("tmp/performance-stage3/fixture.json", "utf8")), accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
const jar = new Map(), results = []; let csrf;
async function raw(path, options = {}) {
	const response = await fetch(root + path, { ...options, headers: { cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...options.headers }, signal: options.signal ?? AbortSignal.timeout(60000) });
	for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
	return response;
}
async function call(path, method = "GET", body) {
	if (method !== "GET" && !csrf) csrf = (await (await raw("/api/csrf")).json()).data.token;
	const response = await raw(path, { method, ...(method === "GET" ? {} : { body: JSON.stringify(body), headers: { origin: root, "Content-Type": "application/json", "x-csrf-token": csrf, "Idempotency-Key": randomUUID() } }) });
	const value = await response.json(); if (!response.ok) throw Object.assign(Error(), { code: value.error?.code, status: response.status });
	return value.data;
}
try {
	const health = await (await raw("/api/health")).json(); assert.equal(health.buildId, expectedBuild);
	results.push({ name: "exact_build_health", status: "PASS", buildId: health.buildId });
	await call("/api/auth/login", "POST", accounts.A);
	const base = `/api/projects/${fixture.projectId}`, project = await call(base);
	assert.equal(project.id, fixture.projectId);
	const access = await call(`${base}/image-access?ids=${[...fixture.images, randomUUID()].join(",")}`);
	assert.equal(access.items.length, fixture.images.length);
	assert.equal(access.items.some(item => !fixture.images.includes(item.id)), false);
	const file = access.items[0], thumb = file.images.find(image => image.variant === 640);
	const response = await raw(`${base}/files/${file.id}/preview?variant=640`);
	assert.equal(response.status, 200); assert.equal(response.headers.get("x-pm-image-namespace"), access.namespace);
	assert.equal(createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex"), thumb.version);
	results.push({ name: "normal_login_isolated_metadata_partial_manifest_private_thumbnail", status: "PASS" });
	const stream = await raw(`${base}/events?cursor=${encodeURIComponent(project.syncCursor)}`, { signal: AbortSignal.timeout(25000) });
	assert.equal(stream.status, 200); assert.ok(stream.headers.get("content-type").includes("text/event-stream"));
	const reader = stream.body.getReader(); const first = await reader.read(); assert.ok(first.value?.byteLength); await reader.cancel();
	results.push({ name: "same_preview_event_stream_initial", status: "PASS" });
} catch (error) {
	results.push({ name: "preview_smoke", status: "FAIL", code: /^[A-Z0-9_]{2,50}$/.test(error.code ?? "") ? error.code : "ASSERTION_OR_DEPENDENCY", httpStatus: error.status }); process.exitCode = 1;
} finally {
	const report = { checkedAt: new Date().toISOString(), url: root, expectedBuildId: expectedBuild, projectRef: "rvysclscetfqicpnzlra", scope: "Normal test login; read-only metadata/private thumbnail and initial SSE. No browser, UI, phone or full cloud write replay.", results };
	await writeFile("docs/evidence/performance-stage3/preview.json", `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report));
}
