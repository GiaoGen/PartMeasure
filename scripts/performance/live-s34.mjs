// Real HTTP and SSE clients. No browser, mocks, service-role login or system proxy.
import { request } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import sharp from "sharp";
const root = process.env.PM_LIVE_ORIGIN ?? "http://127.0.0.1:3111",
	results = [],
	clients = [],
	streams = [];
if (
	root !== "http://127.0.0.1:3111" &&
	!/^https:\/\/partmeasure-staging-[a-z0-9]+-messup-s-projects\.vercel\.app$/.test(root)
)
	throw Error("WRONG_TEST_ORIGIN");
const environment = `real isolated Supabase + ${root.startsWith("https:") ? "Vercel test Preview HTTPS" : "local production Next HTTP"}; no browser; process-direct; VPN/TUN not controlled`;
if (
	process.env.PM_NETWORK_MODE !== "direct" ||
	new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "rvysclscetfqicpnzlra.supabase.co"
)
	throw Error("WRONG_TEST_MODE");
const accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
const fixture = { prefix: `PERF-S34-${Date.now()}` };
let phase = "setup";
let workerChild,
	workerExited = false;
async function check(name, run) {
	try {
		await run();
		results.push({ name, status: "PASS" });
	} catch (e) {
		results.push({
			name,
			status: "FAIL",
			phase,
			code:
				/^HTTP_\d+_[A-Z_]+$/.test(e.message ?? "") ||
				/^(WORKER_FAILED|WORKER_TIMEOUT|FILE_REJECTED|EVENT_TIMEOUT)$/.test(e.message ?? "")
					? e.message
					: "ASSERTION_OR_DEPENDENCY_FAILED",
		});
	}
	console.log(JSON.stringify(results.at(-1)));
}
async function context(account) {
	const c = await request.newContext({ baseURL: root, timeout: 45000 });
	clients.push(c);
	if (account) await call(c, "/api/auth/login", "POST", accounts[account]);
	return c;
}
async function call(c, path, method = "GET", body, revision) {
	const headers = {};
	if (method !== "GET") {
		const res = await c.get("/api/csrf"),
			csrf = await res.json();
		headers.origin = root;
		headers["x-csrf-token"] = csrf.data.token;
		headers["Idempotency-Key"] = randomUUID();
		if (revision !== undefined) headers["X-PM-Revision"] = `"${revision}"`;
	}
	const res = await c.fetch(path, {
			method,
			headers,
			...(body === undefined ? {} : { data: body }),
		}),
		json = await res.json();
	if (!res.ok()) throw Error(`HTTP_${res.status()}_${json.error?.code ?? "UNKNOWN"}`);
	return json.data;
}
async function stream(c, path) {
	const state = await c.storageState(),
		cookie = state.cookies.map((v) => `${v.name}=${v.value}`).join("; "),
		controller = new AbortController();
	const connectTimer = setTimeout(() => controller.abort(), 30000);
	const res = await fetch(root + path, {
		headers: { Cookie: cookie },
		signal: controller.signal,
	});
	clearTimeout(connectTimer);
	const lifetime = setTimeout(() => controller.abort(), 600000);
	if (!res.ok) {
		controller.abort();
		clearTimeout(lifetime);
		throw Error(`HTTP_${res.status}_STREAM`);
	}
	assert.match(res.headers.get("content-type"), /text\/event-stream/);
	const messages = [];
	let changed = () => {},
		buffer = "",
		closed = false;
	const decoder = new TextDecoder();
	const running = (async () => {
		try {
			for await (const bytes of res.body) {
				buffer += decoder.decode(bytes, { stream: true });
				while (buffer.includes("\n\n")) {
					const end = buffer.indexOf("\n\n");
					const raw = buffer.slice(0, end);
					buffer = buffer.slice(end + 2);
					const event = raw
							.split("\n")
							.find((v) => v.startsWith("event: "))
							?.slice(7),
						data = raw
							.split("\n")
							.find((v) => v.startsWith("data: "))
							?.slice(6);
					if (event && data) {
						messages.push({ event, data: JSON.parse(data) });
						changed();
					}
				}
			}
		} catch {
		} finally {
			closed = true;
			changed();
		}
	})();
	const value = {
		stop: async () => {
			clearTimeout(lifetime);
			controller.abort();
			await running;
		},
		wait: async (predicate, ms = 25000) => {
			const deadline = Date.now() + ms;
			while (true) {
				const found = messages.findIndex(predicate);
				if (found >= 0) return messages.splice(found, 1)[0];
				if (closed || Date.now() > deadline) throw Error("EVENT_TIMEOUT");
				await new Promise((resolve) => {
					const timer = setTimeout(resolve, Math.min(200, deadline - Date.now()));
					changed = () => {
						clearTimeout(timer);
						resolve();
					};
				});
			}
		},
	};
	streams.push(value);
	return value;
}
async function worker() {
	if (workerExited) throw Error("WORKER_FAILED");
	if (workerChild) return;
	workerChild = spawn(
		process.execPath,
		[
			"--env-file=.env.local",
			"--env-file=tmp/performance-s34/events.env",
			"--import",
			"tsx",
			"scripts/worker/supervise.ts",
		],
		// A processing measurement must not include a sweep of unrelated old test orphans.
		// The independent cleanup entry is verified separately; no safety processing is skipped.
		{
			env: { ...process.env, PM_WORKER_EXTERNAL_CLEANUP: "1" },
			stdio: ["ignore", "ignore", "ignore"],
			windowsHide: true,
		},
	);
	workerChild.on("error", () => {
		workerExited = true;
	});
	workerChild.on("exit", () => {
		workerExited = true;
	});
}
async function stopWorker() {
	if (!workerChild || workerExited) return;
	if (process.platform === "win32" && workerChild.pid) {
		const killer = spawn("taskkill", ["/PID", String(workerChild.pid), "/T", "/F"], {
			stdio: "ignore",
			windowsHide: true,
		});
		await new Promise((resolve) => {
			killer.once("exit", resolve);
			killer.once("error", resolve);
		});
	} else workerChild.kill();
}
try {
	const A = await context("A"),
		B = await context("B"),
		G = await context();
	const p = await call(A, "/api/projects", "POST", {
		name: fixture.prefix,
		description: "独立实时/缩略图验证",
	});
	fixture.project = p.id;
	let revision = p.revision;
	const O = `/api/projects/${p.id}`,
		GB = `/api/guest/projects/${p.id}`;
	const link = await call(A, `${O}/share-links`, "POST", {});
	fixture.shareUrl = link.url;
	await call(G, "/api/guest/session", "POST", {
		token: new URL(link.url).pathname.split("/").at(-1),
	});
	let ownerCursor = (await call(A, O)).syncCursor,
		guestCursor = (await call(G, GB)).syncCursor,
		os,
		gs;
	await check("Owner-and-Guest-real-SSE-initial-cursor", async () => {
		[os, gs] = await Promise.all([
			stream(A, `${O}/events?cursor=${ownerCursor}`),
			stream(G, `${GB}/events?cursor=${guestCursor}`),
		]);
		await Promise.all([
			os.wait((e) => e.event === "changes"),
			gs.wait((e) => e.event === "changes"),
		]);
	});
	await check("cross-Owner-stream-denied-and-Guest-management-denied", async () => {
		await assert.rejects(stream(B, `${O}/events`), /HTTP_404_/);
		await assert.rejects(
			call(G, `${GB}/deliveries`, "POST", { description: "", fileIds: [] }),
			/HTTP_403_/,
		);
	});
	await check("commit-notification-both-roles-no-refresh", async () => {
		assert.ok(os && gs);
		const start = performance.now();
		const updated = await call(
			A,
			O,
			"PATCH",
			{ name: p.name, description: "双端通知" },
			revision,
		);
		revision = updated.revision;
		const messages = await Promise.all([
			os.wait(
				(e) => e.event === "changes" && e.data.events.some((v) => v.kind === "project.changed"),
			),
			gs.wait(
				(e) => e.event === "changes" && e.data.events.some((v) => v.kind === "project.changed"),
			),
		]);
		results.push({
			name: "write-start-to-both-event-metadata",
			status: "MEASUREMENT",
			milliseconds: Math.round(performance.now() - start),
			scope: "developer direct; includes write; excludes UI paint",
		});
		ownerCursor = messages[0].data.cursor;
		guestCursor = messages[1].data.cursor;
	});
	await check("Guest-private-draft-counter-unchanged", async () => {
		const before = await call(G, `${GB}/changes?cursor=${guestCursor}`);
		await call(A, `${O}/deliveries`, "POST", { description: fixture.prefix, fileIds: [] });
		const after = await call(G, `${GB}/changes?cursor=${before.cursor}`);
		assert.equal(after.sequence, before.sequence);
		assert.equal(after.events.length, 0);
	});
	await check("offline-catchup-and-replay-persistence", async () => {
		await gs?.stop();
		const before = await call(G, `${GB}/changes?cursor=${guestCursor}`);
		const updated = await call(
			A,
			O,
			"PATCH",
			{ name: p.name, description: "离线更新" },
			revision,
		);
		revision = updated.revision;
		const caught = await call(G, `${GB}/changes?cursor=${before.cursor}`);
		assert.ok(caught.events.some((e) => e.kind === "project.changed"));
		assert.deepEqual(
			(await call(G, `${GB}/changes?cursor=${before.cursor}`)).events,
			caught.events,
		);
		gs = await stream(G, `${GB}/events?cursor=${caught.cursor}`);
		await gs.wait((e) => e.event === "changes");
		guestCursor = caught.cursor;
	});
	await check("real-Guest-upload-scan-normalize-thumbnails-and-private-download", async () => {
		phase = "reserve-upload";
		const bytes = await sharp({
			create: {
				width: 960,
				height: 600,
				channels: 3,
				background: { r: Date.now() % 200, g: 110, b: 130 },
			},
		})
			.png()
			.toBuffer();
		const upload = await call(G, `${GB}/uploads`, "POST", {
			filename: `${fixture.prefix}.png`,
			byteSize: bytes.length,
			declaredMime: "image/png",
			sha256: createHash("sha256").update(bytes).digest("hex"),
		});
		fixture.fileId = upload.id;
		phase = "grant-storage-put";
		const grant = await call(G, `${GB}/uploads/${upload.id}/grant`, "POST");
		const uploaded = await fetch(grant.signedUrl, {
			method: "PUT",
			headers: { "Content-Type": "image/png", "x-upsert": "false" },
			body: bytes,
			signal: AbortSignal.timeout(60000),
		});
		assert.ok(uploaded.ok);
		phase = "complete-upload";
		await call(G, `${GB}/uploads/${upload.id}/complete`, "POST", {});
		const start = performance.now();
		// The real local ClamAV worker consumes real private Storage. Never bypass scanning.
		for (let i = 0; i < 60; i++) {
			if (performance.now() - start > 120000) throw Error("WORKER_TIMEOUT");
			phase = "local-worker";
			await worker();
			phase = "processing-state";
			const status = await call(G, `${GB}/uploads/${upload.id}`);
			if (status.state === "ready") break;
			if (status.state === "rejected") throw Error("FILE_REJECTED");
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		const status = await call(G, `${GB}/uploads/${upload.id}`);
		assert.equal(status.state, "ready");
		phase = "file-list-thumbnail-metadata";
		const list = await call(G, `${GB}/files`),
			file = list.items.find((f) => f.id === upload.id);
		assert.ok(file?.thumbnail?.version);
		phase = "private-thumbnail-download";
		const thumb = await G.get(`${GB}/files/${upload.id}/preview?variant=640`);
		assert.equal(thumb.status(), 200);
		const body = await thumb.body();
		assert.ok(body.length <= 262144);
		const meta = await sharp(body).metadata();
		assert.equal(meta.width, 640);
		assert.equal(meta.height, 400);
		phase = "private-canonical-download";
		const original = await G.get(`${GB}/files/${upload.id}/preview`);
		assert.equal(original.status(), 200);
		assert.equal((await sharp(await original.body()).metadata()).width, 960);
		phase = "cross-owner-thumbnail-denied";
		assert.equal((await B.get(`${O}/files/${upload.id}/preview?variant=640`)).status(), 404);
		phase = "public-storage-denied";
		const publicResponse = await fetch(
			`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/partmeasure-private/${p.id}/${upload.id}/thumb-640.webp`,
			{ signal: AbortSignal.timeout(15000) },
		);
		assert.ok([400, 403, 404].includes(publicResponse.status));
		await publicResponse.body?.cancel();
		results.push({
			name: "local-real-worker-safe-image-and-thumbnail",
			status: "MEASUREMENT",
			milliseconds: Math.round(performance.now() - start),
			thumbnailBytes: body.length,
			scope: "local worker; includes API reads; not cloud-near-storage deployment",
		});
	});
	await check("revoked-Guest-stream-unavailable-and-thumbnail-refused", async () => {
		assert.ok(gs);
		await call(A, `${O}/share-links/${link.id}`, "DELETE");
		await gs.wait((e) => e.event === "unavailable");
		await assert.rejects(call(G, `${GB}/changes?cursor=${guestCursor}`), /HTTP_401_/);
		if (fixture.fileId)
			assert.equal(
				(await G.get(`${GB}/files/${fixture.fileId}/preview?variant=640`)).status(),
				401,
			);
	});
} catch (e) {
	results.push({
		name: "setup-or-dependency",
		status: "FAIL",
		code: /^HTTP_\d+_[A-Z_]+$/.test(e.message ?? "")
			? e.message
			: "ASSERTION_OR_DEPENDENCY_FAILED",
	});
} finally {
	await stopWorker();
	await Promise.allSettled(streams.map((s) => s.stop()));
	await Promise.allSettled(clients.map((c) => c.dispose()));
	await mkdir("docs/evidence/performance-s34", { recursive: true });
	await writeFile(
		"docs/evidence/performance-s34/live.json",
		JSON.stringify(
			{
				environment,
				results,
			},
			null,
			2,
		),
	);
	await writeFile(
		`docs/evidence/performance-s34/live-${fixture.prefix}.json`,
		JSON.stringify(
			{
				environment,
				results,
			},
			null,
			2,
		),
	);
	await writeFile("tmp/performance-s34/fixture.json", JSON.stringify(fixture, null, 2), {
		mode: 0o600,
	});
}
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
