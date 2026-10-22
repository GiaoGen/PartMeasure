// Small HTTP/real-isolated-cloud verification. No browser/E2E or production access.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { UploadPipeline } from "../../src/components/upload-pipeline.ts";
import { PersistentImages } from "../../src/components/persistent-images.ts";
const root = "http://127.0.0.1:3136", ref = "rvysclscetfqicpnzlra";
if (process.env.PM_NETWORK_MODE !== "direct" || process.env.NEXT_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co`) throw Error("ISOLATED_ONLY");
const results = [], fixture = {}, prefix = `PERF3-${Date.now()}`;
const accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
function client() {
	const jar = new Map(); let csrf;
	async function raw(path, options = {}) {
		const response = await fetch(root + path, { ...options, headers: { cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...options.headers }, signal: options.signal ?? AbortSignal.timeout(90000) });
		for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
		return response;
	}
	async function call(path, method = "GET", body, key = randomUUID()) {
		if (method !== "GET" && !csrf) csrf = (await (await raw("/api/csrf")).json()).data.token;
		const response = await raw(path, { method, ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}), headers: { origin: root, "Content-Type": "application/json", "x-csrf-token": csrf, "Idempotency-Key": key } }) });
		const value = await response.json();
		if (!response.ok) throw Object.assign(Error("HTTP_FAILED"), { status: response.status, code: value.error?.code });
		return value.data;
	}
	return { raw, call };
}
async function check(name, work) {
	const started = performance.now();
	try { const detail = await work(); results.push({ name, status: "PASS", ms: Math.round(performance.now() - started), ...detail }); }
	catch (error) { results.push({ name, status: "FAIL", ms: Math.round(performance.now() - started), code: /^[A-Z0-9_]{2,50}$/.test(error.code ?? "") ? error.code : "ASSERTION_OR_DEPENDENCY", httpStatus: error.status }); process.exitCode = 1; }
	console.log(JSON.stringify(results.at(-1)));
}
const A = client(), B = client(), G = client(), pipeline = new UploadPipeline(), signal = new AbortController().signal;
let base, guest, link, firstImage, cached, version, namespace, storeReads = 0;
const rows = new Map();
const store = { has: async hash => [...rows.values()].some(row => row.version === hash), get: async key => { storeReads++; return rows.get(key); }, put: async row => { rows.set(row.key, row); }, remove: async matches => { for (const [key, row] of rows) if (matches(row)) rows.delete(key); } };
async function upload(c, scope, filename, bytes, mime, purpose = "material", failBeforePut = false) {
	return pipeline.run(scope, signal, async () => {
		const reservation = await c.call(`${scope}/uploads`, "POST", { filename, byteSize: bytes.length, declaredMime: mime, sha256: createHash("sha256").update(bytes).digest("hex"), ...(purpose === "delivery" ? { purpose } : {}) });
		const grant = await c.call(`${scope}/uploads/${reservation.id}/grant`, "POST");
		if (failBeforePut) await pipeline.finish(signal, () => assert.rejects(c.call(`${scope}/uploads/${reservation.id}/complete`, "POST"), error => error.code === "UPLOAD_OBJECT_NOT_FOUND" && error.status === 503));
		const sent = await fetch(grant.signedUrl, { method: "PUT", body: bytes, headers: { "Content-Type": mime }, signal: AbortSignal.timeout(90000) });
		assert.ok(sent.ok); await sent.body?.cancel();
		const complete = await pipeline.finish(signal, () => c.call(`${scope}/uploads/${reservation.id}/complete`, "POST"));
		assert.equal(complete.state, "ready"); assert.equal(complete.scanPerformed, false);
		assert.equal((await c.call(`${scope}/uploads/${reservation.id}/complete`, "POST")).state, "ready");
		return reservation.id;
	});
}
try {
	await check("same_build_normal_auth_setup", async () => {
		const health = await (await A.raw("/api/health")).json();
		assert.ok(health.buildId.startsWith("perf-20261022-")); fixture.buildId = health.buildId;
		await A.call("/api/auth/login", "POST", accounts.A); await B.call("/api/auth/login", "POST", accounts.B);
		const project = await A.call("/api/projects", "POST", { name: prefix, description: "第三阶段私有缓存/上传/下载小样本" });
		fixture.projectId = project.id; base = `/api/projects/${project.id}`; guest = `/api/guest/projects/${project.id}`;
		link = await A.call(`${base}/share-links`, "POST"); fixture.shareUrl = link.url;
		await G.call("/api/guest/session", "POST", { token: new URL(link.url).pathname.split("/").at(-1) });
		return { buildId: health.buildId };
	});
	await check("two_real_uploads_retryable_failure_and_ready_replay", async () => {
		assert.ok(base);
		const jpg = await readFile("experiments/konva/public/fixtures/640x480-o6-source.jpg");
		const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#34495e" } }).png().toBuffer();
		const ids = await Promise.all([upload(G, guest, "recoverable.jpg", jpg, "image/jpeg", "material", true), upload(G, guest, "pipeline.png", png, "image/png")]);
		fixture.images = ids; firstImage = ids[0];
		const listed = await A.call(`${base}/files`);
		assert.equal(listed.items.filter(file => ids.includes(file.id)).length, 2);
		assert.ok(listed.items.every(file => file.thumbnail));
		return { readyFiles: 2, duplicateAssets: 0, retryUsedSameReservation: true, maxProcessingRequests: 1 };
	});
	await check("fresh_manifest_scope_and_simulated_new_client_byte_reuse", async () => {
		const owner = await A.call(`${base}/image-access?ids=${fixture.images.join(",")}`);
		const access = await G.call(`${guest}/image-access?ids=${fixture.images.join(",")}`);
		assert.notEqual(owner.namespace, access.namespace); namespace = access.namespace;
		const image = access.items.find(file => file.id === firstImage).images.find(image => image.variant === 640); version = image.version;
		const response = await G.raw(`${guest}/files/${firstImage}/preview?variant=640`);
		assert.equal(response.headers.get("x-pm-image-namespace"), namespace);
		assert.equal(response.headers.get("x-pm-image-version"), version);
		const blob = await response.blob(); assert.equal(blob.size, image.bytes);
		const original = new PersistentImages(store); await original.save(namespace, version, `${guest}/files/${firstImage}/preview`, guest, blob, original.guard());
		cached = new PersistentImages(store); let authorizations = 0;
		const reused = await cached.reuse(version, async () => {
			authorizations++; const fresh = await G.call(`${guest}/image-access?ids=${firstImage}`);
			assert.equal(storeReads, 0);
			return { namespace: fresh.namespace, bytes: fresh.items[0].images.find(image => image.variant === 640).bytes };
		}, cached.guard(), () => {});
		assert.deepEqual(Buffer.from(await reused.arrayBuffer()), Buffer.from(await blob.arrayBuffer()));
		await assert.rejects(B.call(`${base}/image-access?ids=${firstImage}`), error => error.status === 404);
		return { freshAuthorizations: authorizations, imageByteGETsForReuse: 0, bytesReused: blob.size, actualBrowserIndexedDB: "manual-pending" };
	});
	await check("private_draft_image_manifest_denied_to_guest", async () => {
		const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#477966" } }).png().toBuffer();
		const id = await upload(A, base, "private-draft.png", png, "image/png", "delivery");
		assert.ok((await A.call(`${base}/image-access?ids=${id}`)).items.length);
		await assert.rejects(G.call(`${guest}/image-access?ids=${id}`), error => error.status === 404);
		return { ownerAllowed: true, guestDenied: true };
	});
	await check("private_range_4MiB_vs_8MiB", async () => {
		const bytes = Buffer.alloc(8 * 1024 * 1024, 32); bytes.write("%PDF-1.7\n1 0 obj<<>>endobj\n"); bytes.write("\n%%EOF", bytes.length - 6);
		const id = await upload(A, base, "range-sample.pdf", bytes, "application/pdf", "delivery");
		const draft = await A.call(`${base}/deliveries`, "POST", { description: "下载分段检查（未发布）", fileIds: [id] });
		fixture.deliveryId = draft.id; const timings = [];
		for (const chunk of [4, 8]) {
			const began = performance.now(), parts = []; let requests = 0;
			for (let start = 0; start < bytes.length; start += chunk * 1024 * 1024) {
				const end = Math.min(bytes.length - 1, start + chunk * 1024 * 1024 - 1);
				const response = await A.raw(`${base}/deliveries/${draft.id}/files/${id}/download`, { headers: { Range: `bytes=${start}-${end}` } });
				assert.equal(response.status, 206); assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${bytes.length}`);
				parts.push(Buffer.from(await response.arrayBuffer())); requests++;
			}
			assert.deepEqual(Buffer.concat(parts), bytes);
			timings.push({ chunkMiB: chunk, requests, ms: Math.round(performance.now() - began), receivedBytes: bytes.length });
		}
		return { samples: timings, integrity: "exact-byte-match" };
	});
	await check("revoked_guest_cannot_reuse_previously_saved_bytes", async () => {
		await A.call(`${base}/share-links/${link.id}`, "DELETE");
		const readsBefore = storeReads;
		await assert.rejects(cached.reuse(version, async () => {
			const access = await G.call(`${guest}/image-access?ids=${firstImage}`);
			return { namespace: access.namespace, bytes: 1 };
		}, cached.guard(), () => {}), error => error.status === 401);
		assert.equal(storeReads, readsBefore);
		return { blobReadsAfterDenial: 0 };
	});
} finally {
	await mkdir("tmp/performance-stage3", { recursive: true }); await mkdir("docs/evidence/performance-stage3", { recursive: true });
	await writeFile("tmp/performance-stage3/fixture.json", `${JSON.stringify(fixture, null, 2)}\n`);
	const report = { checkedAt: new Date().toISOString(), projectRef: ref, sourceBuildId: fixture.buildId, scope: "Local production build HTTP + real isolated Auth/DB/private Storage. Persistent-store adapter simulates a new client; actual browser IndexedDB and UI await manual acceptance.", browser: false, productionDeployment: false, results };
	await writeFile("docs/evidence/performance-stage3/live.json", `${JSON.stringify(report, null, 2)}\n`);
}
