// Authorized FIX-C desktop E2E. Dedicated profiles; no mail/old data/business UI writes.
import assert from "node:assert/strict";
import { chromium, expect as baseExpect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const run = process.argv[2], mode = process.argv[3] ?? "inspect";
if (!/^[a-f0-9-]{36}$/.test(run ?? "") || !["inspect", "exports", "workflow", "revoke"].includes(mode)) throw Error("INVALID_BROWSER_ARGUMENTS");
const root = "http://127.0.0.1:3000", dir = `tmp/fix-c/${run}`;
if (process.env.APP_URL !== root || new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin !== "https://rvysclscetfqicpnzlra.supabase.co") throw Error("ISOLATED_LOOPBACK_ONLY");
const state = JSON.parse(await readFile(`${dir}/state.json`, "utf8"));
assert.equal(state.run, run); if (mode !== "inspect") assert.ok(state.completed.includes("seed"));
const data = name => { assert.equal(state.operations[name]?.status, "done"); return state.operations[name].value; };
const realPhoto = state.operations["real-reserve-photo"]?.status === "done";
const id = data("project").id, photo = data(realPhoto ? "real-reserve-photo" : "reserve-image").id, photoName = realPhoto ? "images.jpg" : "FIX-C-合成照片.png", O = `/api/projects/${id}`, G = `/api/guest/projects/${id}`;
assert.equal(data("project").name, `FIX-C-${run}`);
const accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
const results = [], traffic = [], errors = [], blocked = [], downloads = [];
const driverAtStart = createHash("sha256").update(await readFile("scripts/fix-c/browser.mjs")).digest("hex");
const expect = baseExpect.configure({ timeout: 60000 });
let owner, guest, A, C, stage = "setup";
const jsonPath = `docs/evidence/fix-c/${run}-browser-${mode}-${Date.now()}.json`;
await mkdir(`${dir}/browser`, { recursive: true });
await mkdir(`output/fix-c/${run}`, { recursive: true });
function safeKind(raw) {
	const p = new URL(raw).pathname;
	return p.includes("/events") ? "events" : p.includes("/image-access") ? "image-access" : p.includes("/preview") ? "preview" : p.includes("/annotations") ? "annotations" : p.includes("/deliveries") ? "deliveries" : p.includes("/download") ? "download" : p.includes("/export") || p.includes("/pdf-report") || p.includes("/zip-") ? "export" : p.includes("/auth/") ? "auth" : p.includes("/issues") ? "issues" : "other";
}
async function report() {
	await writeFile(jsonPath, `${JSON.stringify({ checkedAt: new Date().toISOString(), run, mode, browser: owner?.browser()?.version(), apiSourceDigest: state.source,
		browserDriverSha256: driverAtStart, driverUnchanged: driverAtStart === createHash("sha256").update(await readFile("scripts/fix-c/browser.mjs")).digest("hex"),
		scope: "Actual local Chrome + isolated normal Owner/Guest Auth/API/Storage; real IndexedDB. Desktop only, synthetic fixtures, no phone/mainland/hosted/real engineering acceptance.",
		results, traffic, errors, blocked, downloads }, null, 2)}\n`);
}
async function check(name, work) {
	stage = name; console.log(JSON.stringify({ start: name })); const start = performance.now();
	try { const value = await work(); results.push({ name, status: "PASS", milliseconds: Math.round(performance.now() - start) }); await report(); return value; }
	catch (e) {
		results.push({ name, status: "NOT_PASSED", errorClass: e.name, line: Number(String(e.stack ?? "").match(/browser\.mjs:(\d+)/)?.[1] ?? 0), milliseconds: Math.round(performance.now() - start) });
		await A?.screenshot({ path: `${dir}/browser/failure-${mode}-${Date.now()}.png`, fullPage: false }).catch(() => {});
		await C?.screenshot({ path: `${dir}/browser/guest-failure-${mode}-${Date.now()}.png`, fullPage: false }).catch(() => {});
		await report(); throw Error("FIX_C_BROWSER_STOPPED");
	}
}
async function launch(role) {
	const context = await chromium.launchPersistentContext(`${dir}/browser/profile-${role}`, { channel: "chrome", headless: true, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", acceptDownloads: true });
	await context.addInitScript(() => {
		const Native = window.EventSource;
		window.__fixCLive = { changes: 0, rotate: 0, unavailable: 0, opens: 0 };
		window.EventSource = class extends Native {
			constructor(...args) {
				super(...args); window.__fixCLive.opens++;
				for (const name of ["changes", "rotate", "unavailable"]) this.addEventListener(name, () => window.__fixCLive[name]++);
			}
		};
	});
	await context.route("**/*", route => {
		const req = route.request(), url = new URL(req.url());
		if (url.origin === root && url.pathname.startsWith("/api/") && !["GET", "HEAD"].includes(req.method())) {
			// Normal Auth/bootstrap is performed once via context.request below; UI stays read/unsaved/export only.
			blocked.push({ role, kind: safeKind(req.url()), method: req.method() }); return route.abort("blockedbyclient");
		}
		return route.continue();
	});
	context.on("response", response => {
		if (new URL(response.url()).origin !== root || !new URL(response.url()).pathname.startsWith("/api/")) return;
		const t = response.request().timing();
		traffic.push({ role, kind: safeKind(response.url()), status: response.status(), timeToHeadersMs: Math.max(0, Math.round(t.responseStart - t.requestStart)) });
	});
	const page = context.pages()[0] ?? await context.newPage(); page.setDefaultTimeout(60000);
	page.on("pageerror", () => errors.push({ role, kind: "pageerror" }));
	page.on("dialog", dialog => dialog.dismiss());
	return { context, page };
}
async function login(context, account) {
	const csrf = (await (await context.request.get(`${root}/api/csrf`)).json()).data.token;
	const response = await context.request.post(`${root}/api/auth/login`, { headers: { origin: root, "x-csrf-token": csrf }, data: account });
	assert.equal(response.status(), 200);
}
async function openPhoto(page, isGuest = false) {
	await page.goto(`${root}${isGuest ? `/s/session?project=${id}&` : `/projects/${id}?`}section=files&file=${photo}`, { waitUntil: "domcontentloaded" });
	if (!isGuest && await page.getByRole("heading", { name: "项目加载失败", exact: true }).count()) {
		// One UI recovery attempt only after new ordinary-role API evidence; never loop TLS/connectivity errors.
		const healthy = await page.context().request.get(`${root}${O}`);
		assert.equal(healthy.status(), 200);
		results.push({ name: "SSR_recovery_after_fresh_project_API_200", scope: "one retry, no network change" });
		await page.getByRole("button", { name: "重新加载", exact: true }).click();
	}
	await expect(page.locator(".detail-heading h2")).toHaveText(photoName);
	await expect(page.locator(".annotation-viewport canvas").first()).toBeVisible();
}
async function stored(page, base) {
	return page.evaluate(async base => {
		if (!(await indexedDB.databases()).some(db => db.name === "pm-private-image-bytes-v1")) return [];
		const db = await new Promise((resolve, reject) => { const req = indexedDB.open("pm-private-image-bytes-v1", 1); req.onsuccess = () => resolve(req.result); req.onerror = reject; });
		try {
			const rows = await new Promise((resolve, reject) => { const tx = db.transaction("images", "readonly"), req = tx.objectStore("images").getAll(); req.onsuccess = () => resolve(req.result); req.onerror = reject; });
			return await Promise.all(rows.filter(row => row.base === base).map(async row => ({ bytes: row.bytes, blobBytes: row.blob.size, hashMatches: [...new Uint8Array(await crypto.subtle.digest("SHA-256", await row.blob.arrayBuffer()))].map(x => x.toString(16).padStart(2, "0")).join("") === row.version })));
		} finally { db.close(); }
	}, base);
}
async function saveDownload(page, action, label, extension) {
	const pending = page.waitForEvent("download", { timeout: 180000 }); await action();
	const download = await pending; assert.equal(await download.failure(), null);
	const path = `output/fix-c/${run}/${label}.${extension}`;
	await download.saveAs(path); const bytes = await readFile(path); assert.ok(bytes.length > 0);
	downloads.push({ label, path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }); await report(); return path;
}
async function apiPhase(phase) {
	await new Promise((resolve, reject) => {
		const args = phase === "event" ? ["scripts/fix-c/event-comment.ts", run] : ["scripts/fix-c/verify.ts", "--apply", "--run", run, "--phase", phase];
		const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", ...args], { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		child.stdout.on("data", bytes => process.stdout.write(bytes));
		child.stderr.on("data", () => {});
		child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(Error("API_PHASE_FAILED")));
	});
}
try {
	({ context: owner, page: A } = await launch("owner"));
	await check("normal_owner_browser_session", async () => {
		await login(owner, accounts.A); await openPhoto(A);
	});
	if (mode === "inspect") {
		await check("actual_IndexedDB_saved_bytes_hash", async () => {
			await expect.poll(async () => (await stored(A, O)).length).toBeGreaterThan(0);
			const rows = await stored(A, O); assert.ok(rows.every(r => r.hashMatches && r.bytes === r.blobBytes));
		});
		await check("actual_browser_process_reopen_requires_fresh_auth_before_cached_bytes", async () => {
			await owner.close(); ({ context: owner, page: A } = await launch("owner"));
			const start = traffic.length; await openPhoto(A);
			await expect.poll(() => traffic.slice(start).filter(r => r.role === "owner" && r.kind === "image-access" && r.status === 200).length).toBeGreaterThan(0);
			assert.ok((await stored(A, O)).length > 0);
			results.push({ name: "reopen_request_counts", preview: traffic.slice(start).filter(r => r.kind === "preview").length, freshAccess: traffic.slice(start).filter(r => r.kind === "image-access").length });
		});
	}
	if (mode === "exports") {
		await check("actual_png_jpg_pdf_saved_from_current_application", async () => {
			await A.getByLabel("文件操作", { exact: true }).click();
			await A.getByRole("button", { name: "导出图片／PDF", exact: true }).click();
			const section = A.getByRole("region", { name: "标注图片与PDF导出", exact: true });
			for (const format of ["png", "jpg", "pdf"]) {
				await section.getByLabel("格式", { exact: true }).selectOption(format);
				await saveDownload(A, () => section.getByRole("button", { name: format === "pdf" ? "生成PDF并下载" : "生成并下载", exact: true }).click(), `owner-annotated-${format}`, format);
			}
			await section.getByRole("button", { name: "收起", exact: true }).click();
		});
		await check("actual_zip_selected_photo_original_and_version_attachment_saved", async () => {
			if (await A.getByRole("button", { name: "返回资料", exact: true }).count()) await A.getByRole("button", { name: "返回资料", exact: true }).click();
			await A.getByLabel("类型", { exact: true }).selectOption("all");
			await A.getByRole("button", { name: "ZIP资料包", exact: true }).click();
			await A.getByLabel(`选入ZIP：${photoName}`, { exact: true }).check();
			if (realPhoto) {
				await A.getByLabel("选入ZIP：prarice1.SLDPRT", { exact: true }).check();
				await A.getByLabel("选入ZIP：FIX-C-合成照片.png", { exact: true }).check();
			}
			const section = A.locator(".zip-package-export");
			await section.getByLabel("额外附带原始照片（可能含原始EXIF）", { exact: true }).check();
			await section.getByLabel("附带交付附件（可选）", { exact: true }).selectOption(data("publish-v2").id);
			await saveDownload(A, () => section.getByRole("button", { name: "生成ZIP并下载", exact: true }).click(), "owner-package", "zip");
		});
	}
	if (["workflow", "revoke"].includes(mode)) {
		({ context: guest, page: C } = await launch("guest"));
		await check("normal_guest_browser_session_and_deep_link", async () => {
			const marker = `${dir}/browser/guest-created`;
			let exists = true; try { await access(marker); } catch { exists = false; }
			if (!exists) {
				// Write the marker before sending; ambiguous bootstrap does not silently create another session.
				await writeFile(marker, "pending", { flag: "wx" });
				const csrf = (await (await guest.request.get(`${root}/api/csrf`)).json()).data.token;
				const r = await guest.request.post(`${root}/api/guest/session`, { headers: { origin: root, "x-csrf-token": csrf }, data: { token: new URL(data("share").url).pathname.split("/").at(-1) } });
				assert.equal(r.status(), 200); await writeFile(marker, "done");
			} else assert.equal(await readFile(marker, "utf8"), "done");
			await openPhoto(C, true);
		});
		if (mode === "workflow") {
			await check("live_events_preserve_unsaved_delivery_draft_and_guest_comment", async () => {
				await A.getByRole("button", { name: "交付与版本", exact: true }).click();
				await A.getByRole("button", { name: "继续编辑草稿", exact: true }).click();
				await A.getByLabel("交付说明", { exact: true }).fill("FIX-C unsaved owner input");
				await C.getByRole("button", { name: "交付与版本", exact: true }).click();
				await C.locator(".delivery-history-toggle").click();
				await C.locator(".delivery-version-toggle").filter({ hasText: "V001" }).click();
				const oldComment = C.locator(".delivery-history textarea");
				await oldComment.fill("FIX-C unsaved Guest input");
				await apiPhase(state.completed.includes("workflow") ? "event" : "workflow");
				await expect(C.locator(".delivery-history")).toContainText(state.completed.includes("workflow") ? "FIX-C 事件刷新验证（合成）" : "合成指定旧版留言；不代表尺寸验收");
				await expect(A.getByLabel("交付说明", { exact: true })).toHaveValue("FIX-C unsaved owner input");
				await expect(oldComment).toHaveValue("FIX-C unsaved Guest input");
				results.push({ name: "actual_event_counts", owner: await A.evaluate(() => window.__fixCLive), guest: await C.evaluate(() => window.__fixCLive) });
			});
		}
		if (mode === "revoke") await check("revoked_open_guest_view_and_persisted_bytes_cannot_reauthorize", async () => {
			await expect.poll(async () => (await stored(C, G)).length).toBeGreaterThan(0);
			await apiPhase("revoke");
			await expect(C.getByRole("heading", { name: "链接已不可用", exact: true })).toBeVisible();
			await C.reload({ waitUntil: "domcontentloaded" });
			await expect(C.getByRole("heading", { name: "链接已不可用", exact: true })).toBeVisible();
			await expect.poll(async () => (await stored(C, G)).length).toBe(0);
		});
	}
} catch {
	if (!results.some(r => r.status === "NOT_PASSED")) results.push({ name: stage, status: "NOT_PASSED", code: "SETUP_FAILED" });
	process.exitCode = 1;
} finally {
	await report(); await owner?.close().catch(() => {}); await guest?.close().catch(() => {});
}
console.log(JSON.stringify({ report: jsonPath, status: process.exitCode ? "NOT_PASSED" : "PASS", blockedWrites: blocked.length, pageErrors: errors.length }));
