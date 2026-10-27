// P3-05 one authorized incremental batch. Defaults to offline preparation.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { chromium, expect as baseExpect } from "@playwright/test";
import nextEnv from "@next/env";
import { releaseSource } from "./fingerprint.ts";
import { once } from "../fix-c/model.ts";
import { privateDirectory } from "../maintenance/private-directory.ts";

nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const oldRun = "3acb7520-5d8e-4c9e-9a10-e8450c5798bf";
const [mode = "prepare", run, reviewedRoot] = process.argv.slice(2);
assert.ok(["prepare", "authorize", "review", "read", "preflight", "increment", "stream", "revoke"].includes(mode));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
if (mode === "prepare") {
	assert.ok(reviewedRoot === undefined || reviewedRoot === "stream");
	let previous;
	if (run !== undefined) {
		assert.match(run, /^[a-f0-9-]{36}$/);
		previous = JSON.parse(await readFile(`tmp/p3-05/${run}/state.json`, "utf8"));
		assert.equal(previous.operations.revoke?.status, "done"); assert.equal(previous.readComplete, true);
		assert.equal(previous.scope.source, releaseSource().digest);
	}
	const old = JSON.parse(await readFile(`tmp/fix-c/${oldRun}/state.json`, "utf8"));
	const value = key => { assert.equal(old.operations[key].status, "done"); return old.operations[key].value; };
	const id = randomUUID(), dir = `tmp/p3-05/${id}`;
	await privateDirectory(dir);
	const scope = { run: id, root: previous?.scope.root ?? "http://127.0.0.1:3105", source: releaseSource().digest, project: value("project"),
		photo: value("real-reserve-photo").id, syntheticPhoto: value("reserve-image").id,
		cad: value("real-reserve-cad").id, v1: value("publish-v1").id, v2: value("publish-v2").id,
		privateDraft: value("draft-private").id, privateFile: value("reserve-private").id,
		pdf: value("reserve-v1"),
		purpose: reviewedRoot === "stream" ? "long-stream-only" : "event-cache-and-stream",
		limits: { shares: 1, guests: 1, comments: reviewedRoot === "stream" ? 0 : 1, commentCharacters: 200, uploads: 0, newVersions: 0, cleanup: 0, mail: 0, deploy: 0 },
		approvalStatus: "PROPOSED_NOT_AUTHORIZED", reusesReadEvidenceFrom: previous ? run : null,
		approval: "Requires explicit new human authorization before increment; no old authorization reused",
	};
	assert.equal(scope.project.name, `FIX-C-${oldRun}`);
	await writeFile(`${dir}/state.json`, JSON.stringify({ scope, operations: {}, results: previous?.results.filter(r => r.mode === "read") ?? [], downloads: [],
		...(previous ? { ownerStorage: previous.ownerStorage, readComplete: true } : {}),
	}), { flag: "wx" });
	await mkdir("docs/evidence/p3-05", { recursive: true });
	await writeFile(`docs/evidence/p3-05/batch-${id}-scope.json`, JSON.stringify(scope, null, 2));
	console.log(JSON.stringify({ mode, run: id, source: scope.source, networkRequests: 0 }));
	process.exit(0);
}
assert.match(run ?? "", /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin, "https://rvysclscetfqicpnzlra.supabase.co");
const dir = `tmp/p3-05/${run}`, state = JSON.parse(await readFile(`${dir}/state.json`, "utf8")), s = state.scope;
if (mode === "authorize") {
	assert.equal(s.approvalStatus, "PROPOSED_NOT_AUTHORIZED"); assert.deepEqual(state.operations, {});
	s.approvalStatus = "APPROVED"; s.approvedAt = new Date().toISOString();
	s.approval = "Human explicitly approved this exact additional scope in the current chat; not inherited from the previous consumed share.";
	await writeFile(`${dir}/state.json`, JSON.stringify(state));
	await writeFile(`docs/evidence/p3-05/batch-${run}-authorization.json`, JSON.stringify({ run, approvedAt: s.approvedAt, limits: s.limits }, null, 2));
	console.log(JSON.stringify({ run, approvalStatus: s.approvalStatus, networkRequests: 0 })); process.exit(0);
}
if (["increment", "stream"].includes(mode)) { assert.equal(s.approvalStatus, "APPROVED"); assert.equal(state.operations.revoke, undefined, "CLOSED_BATCH_NEVER_REOPENED"); }
if (mode === "stream") assert.equal(s.purpose, "long-stream-only");
if (mode === "increment") assert.notEqual(s.purpose, "long-stream-only");
if (mode === "review") {
	assert.equal(state.operations.share, undefined, "NEVER_RETARGET_A_CREATED_SHARE");
	const deployment = JSON.parse((await readFile("docs/evidence/p3-05/preview-diagnostic-deployment.json", "utf8")).replace(/^\uFEFF/, ""));
	assert.equal(reviewedRoot, `https://${deployment.url}`); assert.equal(deployment.sourceDigest, releaseSource().digest);
	const prior = JSON.parse(await readFile(`docs/evidence/p3-05/candidate-${s.source.slice(0, 20)}.json`, "utf8"));
	const next = releaseSource(), oldFiles = new Map(prior.source.files.map(f => [f.path, f.sha256]));
	const changed = next.files.filter(f => oldFiles.get(f.path) !== f.sha256).map(f => f.path);
	assert.deepEqual(changed, ["next.config.ts"], "REVIEW_UNEXPECTED_SOURCE_CHANGE");
	const review = { at: new Date().toISOString(), previousSource: s.source, currentSource: next.digest, previousRoot: s.root, newRoot: reviewedRoot, changed,
		evidenceReuse: "Actual local PNG/JPG/PDF bytes/visual checks remain valid: no renderer/snapshot/authorization contract changed. Hosted representative reads and unfinished scenarios must run anew.",
	};
	state.sourceReviews = [...(state.sourceReviews ?? []), review]; s.source = next.digest; s.root = reviewedRoot;
	delete state.ownerStorage;
	state.results = state.results.filter(r => r.name !== "normal_owner_auth_and_continuous_representative_reads");
	await writeFile(`${dir}/state.json`, JSON.stringify(state));
	await writeFile(`docs/evidence/p3-05/batch-${run}-source-review.json`, JSON.stringify(review, null, 2));
	console.log(JSON.stringify({ mode, ...review, networkRequests: 0, shareCreated: false })); process.exit(0);
}
const root = s.root;
assert.ok(root === "http://127.0.0.1:3105" || /^https:\/\/partmeasure-staging-[a-z0-9-]+\.vercel\.app$/.test(root));
assert.equal(s.run, run); assert.equal(s.root, root); assert.equal(s.source, releaseSource().digest);
const O = `/api/projects/${s.project.id}`, G = `/api/guest/projects/${s.project.id}`;
const driver = hash(await readFile("scripts/release/business.mjs"));
const reportPath = `docs/evidence/p3-05/batch-${run}-${mode}-${Date.now()}.json`;
const results = [], traffic = [], downloads = [], errors = [], blocked = [];
const expect = baseExpect.configure({ timeout: 45000 });
let browser, A, C, guest, owner, stage = "setup", streamChild, streamExit;
const save = async () => { await writeFile(`${dir}/state.next.json`, JSON.stringify(state)); await rename(`${dir}/state.next.json`, `${dir}/state.json`); };
const report = async () => {
	await writeFile(reportPath, JSON.stringify({ checkedAt: new Date().toISOString(), run, mode, source: s.source,
		sourceUnchanged: releaseSource().digest === s.source, driverSha256: driver, driverUnchanged: hash(await readFile("scripts/release/business.mjs")) === driver,
		browser: browser?.version(), origin: root, scope: "Actual candidate application + real isolated Auth/runtime/Storage; desktop Chrome only. Each scenario records environment; no phone/cloud restore acceptance.",
		results, traffic, downloads, errors, blocked, operations: Object.fromEntries(Object.entries(state.operations).map(([name, op]) => [name, op.status])),
	}, null, 2));
};
async function check(name, work) {
	if (state.results.some(r => r.mode === mode && r.name === name && r.status === "PASS")) {
		const prior = state.results.find(r => r.mode === mode && r.name === name && r.status === "PASS");
		results.push({ name, status: "REUSED_PASS", checkedSource: prior.source ?? state.sourceReviews?.[0]?.previousSource ?? s.source, reviewedCompatibleWith: s.source }); return;
	}
	stage = name; console.log(JSON.stringify({ start: name })); const start = performance.now();
	try { const value = await work(); results.push({ name, status: "PASS", milliseconds: Math.round(performance.now() - start) }); state.results.push({ name, mode, status: "PASS", source: s.source, origin: root }); await save(); await report(); return value; }
	catch (error) {
		results.push({ name, status: "NOT_PASSED", milliseconds: Math.round(performance.now() - start), errorClass: error.name,
			code: error.safeCode ?? "BROWSER_OR_ASSERTION_FAILED", httpStatus: error.httpStatus ?? null,
			line: Number(String(error.stack ?? "").match(/business\.mjs:(\d+)/)?.[1] ?? 0) });
		await A?.screenshot({ path: `${dir}/${mode}-failure.png` }).catch(() => {}); await report(); throw error;
	}
}
async function api(context, path, method = "GET", data, key) {
	const headers = {};
	if (method !== "GET") {
		const csrf = await context.request.get(`${root}/api/csrf`, { timeout: 15000 });
		assert.equal(csrf.status(), 200);
		Object.assign(headers, { origin: root, "x-csrf-token": (await csrf.json()).data.token, ...(key ? { "Idempotency-Key": key } : {}) });
	}
	const response = await context.request.fetch(root + path, { method, headers, ...(data === undefined ? {} : { data }), timeout: 75000, maxRedirects: 0 });
	const body = await response.json();
	traffic.push({ role: context === owner ? "owner" : "guest", kind: path.includes("share-links") ? "share" : path.includes("auth") ? "auth" : "api", status: response.status(), timing: response.headers()["server-timing"] ?? null });
	return { response, body };
}
function success(result, status = 200) {
	if (result.response.status() !== status) {
		const error = new Error("HTTP_NOT_EXPECTED"); error.httpStatus = result.response.status();
		error.safeCode = ["DEPENDENCY_UNAVAILABLE", "AUTH_UNAVAILABLE", "DATABASE_TIMEOUT", "DATABASE_BUSY", "RATE_LIMITED", "AUTH_REQUIRED", "LINK_UNAVAILABLE"].includes(result.body.error?.code) ? result.body.error.code : "UNEXPECTED_HTTP";
		throw error;
	}
	return result.body.data;
}
async function context(role) {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", acceptDownloads: true,
		...(state[`${role}Storage`] ? { storageState: state[`${role}Storage`] } : {}),
	});
	await ctx.route("**/*", route => {
		const r = route.request(), url = new URL(r.url());
		if (url.origin === root && url.pathname.startsWith("/api/") && !["GET", "HEAD"].includes(r.method())) {
			blocked.push({ role, method: r.method(), kind: "UI_WRITE_BLOCKED" }); return route.abort("blockedbyclient");
		}
		return route.continue();
	});
	ctx.on("response", r => {
		if (new URL(r.url()).origin !== root || !new URL(r.url()).pathname.startsWith("/api/")) return;
		const path = new URL(r.url()).pathname;
		traffic.push({ role, kind: path.includes("events") ? "events" : path.includes("image-access") ? "image-access" : path.includes("preview") ? "preview" : "business-read", status: r.status(), timing: r.headers()["server-timing"] ?? null });
	});
	ctx.on("page", page => { page.on("pageerror", () => errors.push({ role, kind: "pageerror" })); page.on("dialog", d => d.dismiss()); });
	return ctx;
}
async function photo(page, isGuest = false) {
	await page.goto(`${root}${isGuest ? `/s/session?project=${s.project.id}&` : `/projects/${s.project.id}?`}section=files&file=${s.photo}`, { waitUntil: "domcontentloaded", timeout: 75000 });
	await expect(page.locator(".detail-heading h2")).toHaveText("images.jpg");
	await expect(page.locator(".annotation-viewport canvas").first()).toBeVisible();
}
async function cached(page) {
	return page.evaluate(async base => {
		if (!(await indexedDB.databases()).some(db => db.name === "pm-private-image-bytes-v1")) return [];
		const db = await new Promise((resolve, reject) => { const q = indexedDB.open("pm-private-image-bytes-v1", 1); q.onsuccess = () => resolve(q.result); q.onerror = reject; });
		try { const rows = await new Promise((resolve, reject) => { const q = db.transaction("images").objectStore("images").getAll(); q.onsuccess = () => resolve(q.result); q.onerror = reject; });
			return await Promise.all(rows.filter(r => r.base === base).map(async r => ({ bytes: r.bytes, hashMatches: [...new Uint8Array(await crypto.subtle.digest("SHA-256", await r.blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, "0")).join("") === r.version })));
		} finally { db.close(); }
	}, G);
}
async function download(page, action, name) {
	const pending = page.waitForEvent("download", { timeout: 180000 }); await action();
	const file = await pending; assert.equal(await file.failure(), null);
	const path = `${dir}/${name}`; await file.saveAs(path); const content = await readFile(path); assert.ok(content.length > 0);
	downloads.push({ name, bytes: content.length, sha256: hash(content) }); state.downloads.push({ name, bytes: content.length, sha256: hash(content) }); await save(); await report();
}
async function revoke() {
	const share = state.operations.share;
	if (share?.status !== "done") return;
	await once(state, "revoke", { share: share.value.id }, randomUUID, save, async key => success(await api(owner, `${O}/share-links/${share.value.id}`, "DELETE", undefined, key)));
}
try {
	const live = await fetch(`${root}/api/health`, { signal: AbortSignal.timeout(10000) }); assert.equal(live.status, 200);
	let expectedBuild = releaseSource().buildId;
	if (root.startsWith("https://")) {
		const provenance = JSON.parse((await readFile("docs/evidence/p3-05/preview-provenance.json", "utf8")).replace(/^\uFEFF/, ""));
		assert.equal(provenance.status, "PROVENANCE_RECONCILED"); assert.equal(provenance.origin, root); assert.equal(provenance.localSourceDigest, s.source);
		const config = provenance.transformation;
		assert.equal(config.path, "vercel.json");
		assert.deepEqual(config.providerConfig, { $schema: "https://openapi.vercel.sh/vercel.json", regions: ["hnd1"], name: "partmeasure-staging" });
		assert.equal(hash(`${JSON.stringify(config.providerConfig)}\n`), config.providerSha256);
		const manifest = releaseSource().files;
		assert.equal(manifest.find(f => f.path === config.path).sha256, config.inputSha256);
		const transformed = manifest.map(f => f.path === config.path ? { ...f, sha256: config.providerSha256 } : f);
		assert.equal(hash(JSON.stringify(transformed)), provenance.providerSourceDigest);
		expectedBuild = `p3-05-${provenance.providerSourceDigest.slice(0, 20)}`;
	}
	assert.equal((await live.json()).buildId, expectedBuild);
	browser = await chromium.launch({ channel: "chrome", headless: true }); owner = await context("owner");
	await check("normal_owner_auth_and_continuous_representative_reads", async () => {
		if (!state.ownerStorage) {
			const account = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8")).A;
			success(await api(owner, "/api/auth/login", "POST", account)); state.ownerStorage = await owner.storageState(); await save();
		}
		success(await api(owner, "/api/auth/session"));
		if (mode === "read") for (const path of [O, `${O}/files/${s.photo}`, `${O}/files/${s.photo}/annotations`, `${O}/deliveries/${s.v2}`]) success(await api(owner, path));
	});
	A = await owner.newPage();
	if (mode === "preflight") {
		await check("owner_inline_delivery_input_and_history_selectors_preflight_unsaved_only", async () => {
			await photo(A); await A.getByRole("button", { name: "交付与版本", exact: true }).click();
			await expect(A.getByLabel("交付说明", { exact: true })).toBeVisible();
			await A.getByLabel("交付说明", { exact: true }).fill("P3-05 preflight unsaved only");
			await A.locator(".delivery-history-toggle").click();
			await A.locator(".delivery-version-toggle").filter({ hasText: "V001" }).click();
			await expect(A.locator(".delivery-history-detail")).toContainText("V001");
			await A.getByRole("button", { name: "资料与补测", exact: true }).click();
			await A.getByRole("button", { name: "交付与版本", exact: true }).click();
			await expect(A.getByLabel("交付说明", { exact: true })).toHaveValue("P3-05 preflight unsaved only");
		});
		await check("already_revoked_guest_exact_API_and_page_denial_no_new_session", async () => {
			assert.equal(state.operations.revoke?.status, "done"); guest = await context("guest");
			for (const path of [G, `${G}/files/${s.photo}/download`, `${G}/image-access?ids=${s.photo}`]) {
				const result = await api(guest, path); assert.equal(result.response.status(), 401); assert.equal(result.body.error.code, "LINK_UNAVAILABLE");
			}
			C = await guest.newPage(); await C.goto(`${root}/s/session?project=${s.project.id}`, { waitUntil: "domcontentloaded" });
			await expect(C.getByRole("heading", { name: "链接已不可用", exact: true })).toBeVisible();
		});
	}
	if (mode === "read") {
		await check("saved_photo_and_actual_png_jpg_pdf_exports", async () => {
			await photo(A); await A.getByLabel("文件操作", { exact: true }).click();
			await A.getByRole("button", { name: "导出图片／PDF", exact: true }).click();
			const section = A.getByRole("region", { name: "标注图片与PDF导出", exact: true });
			for (const format of ["png", "jpg", "pdf"]) {
				await section.getByLabel("格式", { exact: true }).selectOption(format);
				await download(A, () => section.getByRole("button", { name: format === "pdf" ? "生成PDF并下载" : "生成并下载", exact: true }).click(), `annotated.${format}`);
			}
			await section.getByRole("button", { name: "收起", exact: true }).click();
		});
		await check("actual_selected_zip_with_originals_and_existing_version", async () => {
			await A.goto(`${root}/projects/${s.project.id}?section=files`, { waitUntil: "domcontentloaded", timeout: 75000 });
			// The wrapping label also contains option text; exact label text is not its computed label.
			const typeFilter = A.locator(".workspace-file-filters select").first();
			await expect(typeFilter).toBeVisible();
			await typeFilter.selectOption("all"); await A.getByRole("button", { name: "ZIP资料包", exact: true }).click();
			for (const name of ["images.jpg", "prarice1.SLDPRT", "FIX-C-合成照片.png"]) await A.getByLabel(`选入ZIP：${name}`, { exact: true }).check();
			const section = A.locator(".zip-package-export"); await section.getByLabel("额外附带原始照片（可能含原始EXIF）", { exact: true }).check();
			await section.getByLabel("附带交付附件（可选）", { exact: true }).selectOption(s.v2);
			await download(A, () => section.getByRole("button", { name: "生成ZIP并下载", exact: true }).click(), "package.zip");
		});
		await check("desktop_unsaved_annotation_tab_history_theme_help_cv_cancel_manual_fallback", async () => {
			await A.close(); A = await owner.newPage(); await photo(A);
			await A.getByRole("button", { name: "识别圆／椭圆", exact: true }).click();
			await A.getByRole("button", { name: "取消辅助", exact: true }).click();
			await expect(A.locator(".annotation-cv-results")).toContainText("已取消");
			await A.getByRole("button", { name: "线段", exact: true }).click();
			const box = await A.locator(".annotation-viewport").boundingBox(); assert.ok(box);
			await A.mouse.move(box.x + box.width * .25, box.y + box.height * .35); await A.mouse.down(); await A.mouse.move(box.x + box.width * .65, box.y + box.height * .45, { steps: 4 }); await A.mouse.up();
			await A.getByLabel("名称", { exact: true }).fill("P3-05 未保存输入");
			await A.getByRole("button", { name: "交付与版本", exact: true }).click(); await A.getByRole("button", { name: "资料与补测", exact: true }).click();
			await A.goBack(); await A.goForward(); await expect(A.getByLabel("名称", { exact: true })).toHaveValue("P3-05 未保存输入");
			for (const theme of ["dark", "light", "system"]) await A.getByLabel("外观", { exact: true }).selectOption(theme);
			await A.locator(".engineering-guidance > summary").click(); await A.getByLabel("测量方式", { exact: true }).selectOption("outside");
			await A.locator(".measurement-help > summary").first().click(); await expect(A.getByLabel("名称", { exact: true })).toHaveValue("P3-05 未保存输入");
			await A.getByRole("button", { name: "撤销", exact: true }).click(); await A.getByRole("button", { name: "重做", exact: true }).click();
		});
		state.readComplete = true; await save();
	}
	if (["increment", "stream"].includes(mode)) {
		assert.equal(state.readComplete, true, "READ_PHASE_MUST_PASS_FIRST");
		await check("create_one_new_share_and_normal_guest", async () => {
			const project = success(await api(owner, O));
			if (!state.operations.share) assert.ok(!project.share || project.share.revokedAt, "EXISTING_LIVE_SHARE_MUST_NOT_BE_REVOKED");
			const share = await once(state, "share", { project: s.project.id }, randomUUID, save, async key => success(await api(owner, `${O}/share-links`, "POST", {}, key), 201));
			assert.ok(share.url); guest = await context("guest");
			if (!state.operations.guest1) await once(state, "guest1", { share: share.id }, randomUUID, save, async key => {
				const value = success(await api(guest, "/api/guest/session", "POST", { token: new URL(share.url).pathname.split("/").at(-1) }, key));
				state.guestStorage = await guest.storageState(); return value;
			});
			if (mode === "increment") { C = await guest.newPage(); await photo(C, true); }
			else {
				const metadata = success(await api(guest, `${G}/files/${s.pdf.id}`));
				assert.equal(metadata.id, s.pdf.id);
			}
		});
		if (mode === "increment") await check("actual_event_preserves_unsaved_owner_and_guest_delivery_input", async () => {
			await photo(A); await A.getByRole("button", { name: "交付与版本", exact: true }).click();
			// Current desktop layout renders the existing draft inline.
			await expect(A.getByLabel("交付说明", { exact: true })).toBeVisible();
			await A.getByLabel("交付说明", { exact: true }).fill("P3-05 Owner unsaved");
			await C.getByRole("button", { name: "交付与版本", exact: true }).click(); await C.locator(".delivery-history-toggle").click();
			await C.locator(".delivery-version-toggle").filter({ hasText: "V001" }).click();
			const input = C.locator(".delivery-history textarea"); await input.fill("P3-05 Guest unsaved");
			for (const role of ["owner", "guest"]) await expect.poll(() => traffic.some(r => r.role === role && r.kind === "events" && r.status === 200)).toBe(true);
			const body = { kind: "comment", body: "P3-05 事件刷新验证（合成）", guestLabel: "P3-05 Guest" };
			await once(state, "comment", body, randomUUID, save, async key => success(await api(guest, `${G}/deliveries/${s.v1}/feedback`, "POST", body, key), 201));
			await expect(C.locator(".delivery-history")).toContainText(body.body);
			await expect(A.getByLabel("交付说明", { exact: true })).toHaveValue("P3-05 Owner unsaved"); await expect(input).toHaveValue("P3-05 Guest unsaved");
		});
		if (mode === "increment") await check("real_guest_cache_is_authenticated_before_reuse", async () => {
			await C.close(); C = await guest.newPage(); await photo(C, true);
			await expect.poll(() => cached(C)).not.toEqual([]); assert.ok((await cached(C)).every(r => r.hashMatches && r.bytes > 0));
			const after = traffic.length;
			await C.reload({ waitUntil: "domcontentloaded" }); await expect(C.locator(".annotation-viewport canvas").first()).toBeVisible();
			await expect.poll(() => traffic.slice(after).some(r => r.role === "guest" && r.kind === "image-access" && r.status === 200)).toBe(true);
		});
		// One real service-layer stream with the same normal Guest. No extra Guest or fixture data.
		stage = "real_service_inflight_setup";
		streamChild = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/release/inflight.ts", run], { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
		streamExit = new Promise(resolve => { streamChild.once("error", () => resolve(1)); streamChild.once("exit", code => resolve(code ?? 1)); });
		let ready = false, exited = false;
		void streamExit.then(() => { exited = true; });
		const streamStart = Date.now();
		while (!ready && !exited && Date.now() - streamStart < 50000) {
			try { await readFile(`${dir}/inflight-ready`); ready = true; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
		}
		if (!ready && !exited) streamChild.kill();
		results.push({ name: "real_service_inflight_setup", status: ready ? "PASS" : "NOT_PASSED", milliseconds: Date.now() - streamStart, scope: "Actual source service/RLS/Storage, paused consumer; not hosted HTTP stream" });
		await report();
		await check("revoke_this_share_then_new_reads_and_browser_cached_access_fail_closed", async () => {
			await revoke();
			if (ready) await writeFile(`${dir}/inflight-revoked`, "confirmed by successful hosted normal Owner revoke");
			for (const path of [G, `${G}/files/${s.photo}/download`, `${G}/image-access?ids=${s.photo}`]) {
				const result = await api(guest, path); assert.equal(result.response.status(), 401); assert.equal(result.body.error.code, "LINK_UNAVAILABLE");
			}
			if (C) {
				await C.reload({ waitUntil: "domcontentloaded" }); await expect(C.getByRole("heading", { name: "链接已不可用", exact: true })).toBeVisible();
				await expect.poll(() => cached(C)).toEqual([]);
			}
		});
		await streamExit;
		try {
			const inflight = JSON.parse(await readFile(`docs/evidence/p3-05/batch-${run}-inflight.json`, "utf8"));
			results.push({ name: "actual_service_stream_revoked_before_next_chunk", status: inflight.status, scope: inflight.scope });
			if (inflight.status !== "PASS") process.exitCode = 1;
		} catch { results.push({ name: "actual_service_stream_revoked_before_next_chunk", status: "NOT_PASSED", code: "STREAM_EVIDENCE_UNAVAILABLE" }); process.exitCode = 1; }
	}
	if (mode === "revoke") await check("explicit_revoke_only_this_batch_share", revoke);
	assert.equal(errors.length, 0); assert.equal(blocked.length, 0); assert.equal(releaseSource().digest, s.source);
} catch {
	if (!results.some(r => r.status === "NOT_PASSED")) results.push({ name: stage, status: "NOT_PASSED", code: "SETUP_FAILED" });
	process.exitCode = 1;
} finally {
	// The approved share must not be left live after any attempted incremental flow.
	if (["increment", "stream"].includes(mode) && state.operations.share?.status === "done" && !state.operations.revoke) {
		try { await check("revoke_after_incomplete_increment", revoke); } catch { process.exitCode = 1; }
	}
	if (streamChild && streamChild.exitCode === null) streamChild.kill();
	await report(); await owner?.close().catch(() => {}); await guest?.close().catch(() => {}); await browser?.close().catch(() => {});
}
console.log(JSON.stringify({ run, mode, status: process.exitCode ? "NOT_PASSED" : "PASS", results: results.map(r => ({ name: r.name, status: r.status })) }));
