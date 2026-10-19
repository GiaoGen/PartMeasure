// Real test-project HTTP regression. Only PERF-S12 tasks/projects/drafts are created.
// No browser, admin-created users, remote DDL, existing-file deletion or share rotation.
import { request } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { applyIssueWrite } from "../../src/lib/issues.ts";

if (process.env.PM_NETWORK_MODE !== "direct" || new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "rvysclscetfqicpnzlra.supabase.co") throw Error("WRONG_TEST_MODE");
const root = "http://127.0.0.1:3110";
const accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
const fixture = JSON.parse(await readFile("tmp/p0-3/fixture.json", "utf8"));
const deliveryFixture = JSON.parse(await readFile("tmp/p0-4/fixture.json", "utf8"));
const prefix = `PERF-S12-${Date.now()}`;
const results = [], clients = [], created = { prefix };
async function call(c, path, method = "GET", body, options = {}) {
	const headers = {};
	if (method !== "GET") {
		const csrf = await (await c.get("/api/csrf")).json();
		Object.assign(headers, { origin: root, "x-csrf-token": csrf.data.token, "Idempotency-Key": options.key ?? randomUUID(),
			...(options.revision === undefined ? {} : { "X-PM-Revision": `"${options.revision}"` }) });
	}
	const response = await c.fetch(path, { method, headers, ...(body === undefined ? {} : { data: body }) });
	const json = (response.headers()["content-type"] ?? "").includes("application/json") ? await response.json() : null;
	return { status: response.status(), data: json?.data, code: json?.error?.code, response };
}
function data(r, status = 200) { assert.equal(r.status, status, `HTTP_${r.status}_${r.code ?? "UNEXPECTED"}`); return r.data; }
async function check(name, work) {
	try { await work(); results.push({ name, status: "PASS" }); }
	catch (e) { results.push({ name, status: "FAIL", code: /^HTTP_\d+_[A-Z_]+$/.test(e.message ?? "") ? e.message : "ASSERTION_OR_DEPENDENCY_FAILED" }); }
	console.log(JSON.stringify(results.at(-1)));
}
async function context(actor) {
	const c = await request.newContext({ baseURL: root, timeout: 25000 }); clients.push(c);
	if (actor) data(await call(c, "/api/auth/login", "POST", accounts[actor]));
	return c;
}
try {
	const A = await context("A"), B = await context("B"), G = await context();
	const O = `/api/projects/${fixture.projectA}`, GB = `/api/guest/projects/${fixture.projectA}`;
	await check("owner-isolation", async () => { assert.equal((await call(B, `${O}/files`)).status, 404); });
	await check("new-test-project-draft-privacy-and-share-revocation", async () => {
		const project = data(await call(A, "/api/projects", "POST", { name: prefix, description: "隔离性能回归；不清理已有资料" }), 201);
		created.projectId = project.id;
		const ownerBase = `/api/projects/${project.id}`, guestBase = `/api/guest/projects/${project.id}`;
		const draft = data(await call(A, `${ownerBase}/deliveries`, "POST", { description: prefix, fileIds: [] }), 201);
		assert.deepEqual(data(await call(A, `${ownerBase}/deliveries`)).drafts, [draft]);
		const share = data(await call(A, `${ownerBase}/share-links`, "POST", {}), 201), visitor = await context();
		data(await call(visitor, "/api/guest/session", "POST", { token: new URL(share.url).pathname.split("/").at(-1) }));
		assert.deepEqual(data(await call(visitor, `${guestBase}/deliveries`)), { published: null, drafts: [] });
		assert.equal((await call(visitor, `${guestBase}/deliveries/${draft.id}`)).status, 404);
		assert.equal((await call(visitor, `${guestBase}/deliveries`, "POST", { description: "denied", fileIds: [] })).status, 403);
		data(await call(A, `${ownerBase}/share-links/${share.id}`, "DELETE", {}));
		assert.equal((await call(visitor, `${guestBase}/deliveries`)).status, 401);
	});
	await check("delivery-batch-equals-detail", async () => {
		const list = data(await call(A, `/api/projects/${deliveryFixture.projectA}/deliveries`));
		assert.ok(list.published, "published fixture required");
		for (const entry of [list.published, ...list.drafts].slice(0, 3)) {
			assert.deepEqual(data(await call(A, `/api/projects/${deliveryFixture.projectA}/deliveries/${entry.id}`)), entry);
		}
	});
	let guestReady = false;
	await check("existing-guest-session-normal-bootstrap", async () => {
		data(await call(G, "/api/guest/session", "POST", { token: new URL(fixture.shareUrl).pathname.split("/").at(-1) }));
		guestReady = true;
	});
	const files = data(await call(A, `${O}/files`)).items;
	const image = files.find(f => f.id === fixture.image) ?? files.find(f => f.mime === "image/webp");
	assert.ok(image);
	const annotations = data(await call(A, `${O}/files/${image.id}/annotations`));
	const annotation = annotations.items.find(a => !a.deleted); assert.ok(annotation);
	let issue;
	await check("create-prefixed-measurement", async () => {
		issue = data(await call(A, `${O}/issues`, "POST", { kind: "measurement", fileId: image.id, annotationRef: { id: annotation.id, revision: annotation.revision }, title: prefix, targetInfo: "性能回归固定目标", description: "仅隔离测试任务", measurementMethod: "unspecified" }), 201);
		created.issueId = issue.id;
	});
	if (issue && guestReady) {
		const start = data(await call(G, `${GB}/issues/${issue.id}`));
		await check("annotation-filter-no-detail-fanout", async () => {
			const list = data(await call(G, `${GB}/files/${image.id}/issues?annotationId=${annotation.id}`));
			assert.equal(list.filterScope, "annotation");
			assert.ok(list.items.every(i => i.annotationRef?.id === annotation.id));
		});
		await check("cross-project-evidence-rejected-without-history-write", async () => {
			assert.equal((await call(G, `${GB}/issues/${issue.id}/responses`, "POST", { kind: "numeric", value: "12.3", unit: "mm", body: "", guestLabel: "", evidenceFileIds: [deliveryFixture.material.id] }, { revision: 1 })).status, 422);
			const after = data(await call(A, `${O}/issues/${issue.id}`));
			assert.equal(after.revision, 1); assert.equal(after.responses.length, 0);
		});
		let submitted;
		await check("response-delta-idempotency-batch-evidence-and-restore", async () => {
			const input = { kind: "numeric", value: "12.3", unit: "mm", body: "原回复保留", guestLabel: "", evidenceFileIds: files.slice(0, 2).map(f => f.id) };
			const key = randomUUID();
			submitted = data(await call(G, `${GB}/issues/${issue.id}/responses`, "POST", input, { revision: 1, key }), 201);
			assert.deepEqual(data(await call(G, `${GB}/issues/${issue.id}/responses`, "POST", input, { revision: 1, key }), 201), submitted);
			const restored = data(await call(A, `${O}/issues/${issue.id}`));
			assert.deepEqual(applyIssueWrite(start, submitted), restored);
			assert.equal(restored.responses.length, 1);
			assert.equal(restored.responses[0].attachments.length, input.evidenceFileIds.length);
		});
		if (submitted) {
			const review = { decision: "confirm", responseId: submitted.responseId, value: "12.4", unit: "mm", source: "owner_manual", note: "性能回归：保留原回复，人工修正" };
			await check("guest-review-denied", async () => { assert.equal((await call(G, `${GB}/issues/${issue.id}/review`, "POST", review, { revision: 2 })).status, 403); });
			await check("review-delta-idempotency-original-history-and-restore", async () => {
				const current = data(await call(A, `${O}/issues/${issue.id}`)), key = randomUUID();
				const reviewed = data(await call(A, `${O}/issues/${issue.id}/review`, "POST", review, { revision: 2, key }), 201);
				assert.deepEqual(data(await call(A, `${O}/issues/${issue.id}/review`, "POST", review, { revision: 2, key }), 201), reviewed);
				const restored = data(await call(G, `${GB}/issues/${issue.id}`));
				assert.deepEqual(applyIssueWrite(current, reviewed), restored);
				assert.equal(restored.responses[0].value, "12.3"); assert.equal(restored.reviews[0].value, "12.4");
			});
		}
		await check("private-image-range-preview-and-cross-project-denial", async () => {
			const response = await G.get(`${GB}/files/${image.id}/preview`, { headers: { Range: "bytes=0-63" } });
			assert.equal(response.status(), 206); assert.equal((await response.body()).length, 64);
			assert.equal((await call(G, `${GB}/files/${deliveryFixture.material.id}/preview`)).status, 404);
		});
	}
} catch {
	results.push({ name: "dependent-checks-interrupted", status: "FAIL", code: "FIXTURE_OR_DEPENDENCY_UNAVAILABLE" });
} finally {
	for (const c of clients) await c.dispose();
	await mkdir("docs/evidence/performance-s12", { recursive: true }); await mkdir("tmp/performance-s12", { recursive: true });
	await writeFile("tmp/performance-s12/regression-fixture.json", `${JSON.stringify(created)}\n`);
	const report = { checkedAt: new Date().toISOString(), realService: true, browserLaunched: false, networkMode: "direct-process-no-http-proxy", mainlandPhoneValidated: false, results };
	await writeFile("docs/evidence/performance-s12/regression.json", `${JSON.stringify(report, null, 2)}\n`);
	await writeFile(`docs/evidence/performance-s12/regression-${Date.now()}.json`, `${JSON.stringify(report, null, 2)}\n`);
}
if (!results.length || results.some(r => r.status !== "PASS")) process.exitCode = 1;
