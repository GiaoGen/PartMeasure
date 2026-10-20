// Normal HTTP/Auth/Storage + SSE, not browser/E2E. Fixtures are independently marked.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const root = "http://127.0.0.1:3121";
if (process.env.PM_NETWORK_MODE !== "direct" || new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "rvysclscetfqicpnzlra.supabase.co") throw Error("WRONG_PROJECT");
const accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
const prefix = `LIGHT-${Date.now()}`, results = [], fixture = { prefix };
let stage = "setup";
function client() {
	const jar = new Map(); let token;
	const headers = () => ({ cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") });
	async function raw(path, init = {}) {
		stage = path.endsWith("/complete") ? "complete" : path.includes("/events?") ? "open-stream" : path.endsWith("/grant") ? "grant" : path.endsWith("/uploads") ? "reserve" : path.includes("/preview") ? "preview" : path.includes("/download") ? "download" : "metadata";
		const r = await fetch(root + path, { ...init, headers: { ...headers(), ...init.headers }, signal: init.signal ?? AbortSignal.timeout(75000) });
		for (const cookie of r.headers.getSetCookie()) { const p = cookie.split(";")[0], i = p.indexOf("="); jar.set(p.slice(0, i), p.slice(i + 1)); }
		return r;
	}
	async function call(path, method = "GET", body, key = randomUUID()) {
		if (method !== "GET" && !token) token = (await (await raw("/api/csrf")).json()).data?.token;
		const r = await raw(path, { method, headers: method !== "GET" ? { origin: root, "x-csrf-token": token, "Idempotency-Key": key, "Content-Type": "application/json" } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
		const j = await r.json(); if (!r.ok) throw Object.assign(Error(), { code: j.error?.code, status: r.status });
		return j.data;
	}
	return { call, raw };
}
async function check(name, work) {
	if (process.env.PM_LIGHT_FOCUS === "1" && !["normal-password-setup", "Guest-image-ready-without-worker-or-scanner-and-owner-SSE"].includes(name)) return;
	const started = Date.now();
	try { await work(); results.push({ name, status: "PASS", milliseconds: Date.now() - started }); }
	catch (e) { results.push({ name, status: "FAIL", code: /^[A-Z0-9_]+$/.test(e.code ?? "") ? e.code : "ASSERTION_OR_DEPENDENCY_FAILED", stage, errorName: e.name, transportCode: /^[A-Z0-9_]+$/.test(e.cause?.code ?? "") ? e.cause.code : undefined, ...(e.status ? { httpStatus: e.status } : {}) }); }
	console.log(JSON.stringify(results.at(-1)));
}
const A = client(), B = client(), G = client(); let base, guestBase, upload, readyEvent;
const streamAbort = new AbortController();
async function store(c, base, name, bytes, mime) {
	const r = await c.call(`${base}/uploads`, "POST", { filename: name, byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), declaredMime: mime });
	const grant = await c.call(`${base}/uploads/${r.id}/grant`, "POST");
	stage = "direct-upload";
	const sent = await fetch(grant.signedUrl, { method: "PUT", headers: { "Content-Type": mime }, body: bytes, signal: AbortSignal.timeout(60000) });
	assert.ok(sent.ok); await sent.body?.cancel(); return r;
}
try {
	await check("normal-password-setup", async () => {
		await A.call("/api/auth/login", "POST", accounts.A); await B.call("/api/auth/login", "POST", accounts.B);
		const project = await A.call("/api/projects", "POST", { name: prefix, description: "无Worker真实上传回归" });
		fixture.project = project.id; base = `/api/projects/${project.id}`; guestBase = `/api/guest/projects/${project.id}`;
		const link = await A.call(`${base}/share-links`, "POST", {}); fixture.shareUrl = link.url;
		await G.call("/api/guest/session", "POST", { token: new URL(link.url).pathname.split("/").at(-1) });
	});
	await check("Guest-image-ready-without-worker-or-scanner-and-owner-SSE", async () => {
		assert.ok(base);
		const bytes = await readFile("experiments/konva/public/fixtures/640x480-o6-source.jpg");
		upload = await store(G, guestBase, "orientation-6.jpg", bytes, "image/jpeg"); fixture.upload = upload.id;
		const cursor = (await A.call(base)).syncCursor;
		const stream = await A.raw(`${base}/events?cursor=${encodeURIComponent(cursor)}`, { signal: AbortSignal.any([streamAbort.signal, AbortSignal.timeout(60000)]) });
		assert.equal(stream.status, 200);
		readyEvent = (async () => {
			let buffer = ""; const decoder = new TextDecoder();
			for await (const part of stream.body) {
				buffer += decoder.decode(part, { stream: true });
				while (buffer.includes("\n\n")) {
					const end = buffer.indexOf("\n\n"), chunk = buffer.slice(0, end); buffer = buffer.slice(end + 2);
					const data = chunk.split("\n").find(x => x.startsWith("data: "))?.slice(6);
					if (data && JSON.parse(data).events?.some(e => e.kind === "file.changed" && e.fileId === upload.id && e.state === "ready")) return;
				}
			} throw Error("EVENT_NOT_RECEIVED");
		})();
		readyEvent.catch(() => {});
		const started = Date.now(), done = await G.call(`${guestBase}/uploads/${upload.id}/complete`, "POST", {});
		fixture.completionMilliseconds = Date.now() - started;
		assert.equal(done.state, "ready"); assert.equal(done.scanPerformed, false); assert.equal(done.validationPolicy, "format-only-v2");
		await readyEvent;
		const file = (await A.call(`${base}/files`)).items.find(x => x.id === upload.id);
		assert.ok(file?.thumbnail);
		const preview = await G.raw(`${guestBase}/files/${upload.id}/preview?variant=640`);
		assert.equal(preview.status, 200); assert.ok((await preview.arrayBuffer()).byteLength <= 262144);
	});
	streamAbort.abort();
	await check("refresh-recovery-and-complete-replay-create-one-asset", async () => {
		assert.ok(upload);
		assert.equal((await G.call(`${guestBase}/uploads/${upload.id}/complete`, "POST", {})).state, "ready");
		assert.equal((await A.call(`${base}/files`)).items.filter(x => x.id === upload.id).length, 1);
		assert.equal((await G.call(`${guestBase}/uploads/${upload.id}`)).state, "ready");
	});
	await check("Owner-PDF-is-ready-and-private-download-keeps-original-bytes", async () => {
		const bytes = Buffer.from(`%PDF-1.7\n${prefix}\n%%EOF`), r = await store(A, base, "sample.pdf", bytes, "application/pdf");
		assert.equal((await A.call(`${base}/uploads/${r.id}/complete`, "POST", {})).state, "ready");
		const download = await G.raw(`${guestBase}/files/${r.id}/download`); assert.equal(download.status, 200);
		assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
	});
	await check("disguised-and-oversized-files-rejected-without-blocking-valid-files", async () => {
		const r = await store(G, guestBase, "forged.png", Buffer.from(`invalid-${prefix}`), "image/png");
		await assert.rejects(() => G.call(`${guestBase}/uploads/${r.id}/complete`, "POST", {}), e => e.status === 422 && e.code === "MAGIC_MISMATCH");
		assert.equal((await G.call(`${guestBase}/uploads/${r.id}`)).state, "rejected");
		await assert.rejects(() => A.call(`${base}/uploads`, "POST", { filename: "large.pdf", byteSize: 52428801, declaredMime: "application/pdf", sha256: "f".repeat(64) }), e => e.status === 413);
	});
	await check("B-isolation-Guest-delivery-denial-and-revoked-completion", async () => {
		await assert.rejects(() => B.call(`${base}/uploads/${upload.id}/complete`, "POST", {}), e => e.status === 404);
		await assert.rejects(() => G.call(`${guestBase}/uploads`, "POST", { filename: "delivery.pdf", byteSize: 8, declaredMime: "application/pdf", sha256: "e".repeat(64), purpose: "delivery" }), e => e.status === 403);
		const r = await store(G, guestBase, "before-revocation.pdf", Buffer.from(`%PDF-1.7\nrevoke-${prefix}`), "application/pdf");
		const share = (await A.call(base)).share; await A.call(`${base}/share-links/${share.id}`, "DELETE");
		await assert.rejects(() => G.call(`${guestBase}/uploads/${r.id}/complete`, "POST", {}), e => e.status === 401);
	});
} finally {
	streamAbort.abort(); await readyEvent?.catch(() => {});
	await mkdir("docs/evidence/lightweight", { recursive: true }); await mkdir("tmp/lightweight", { recursive: true });
	await writeFile("tmp/lightweight/fixture.json", `${JSON.stringify(fixture, null, 2)}\n`);
	const report = `${JSON.stringify({ checkedAt: new Date().toISOString(), scope: "Local production Next + real isolated Auth/DB/private Storage; HTTP/SSE only", completionMilliseconds: fixture.completionMilliseconds, results }, null, 2)}\n`;
	await writeFile(`docs/evidence/lightweight/live-${Date.now()}.json`, report);
	await writeFile(process.env.PM_LIGHT_FOCUS === "1" ? "docs/evidence/lightweight/focused.json" : "docs/evidence/lightweight/live.json", report);
}
if (results.some(r => r.status !== "PASS")) process.exitCode = 1;
