// Actual API module + cookie transport only; no browser, mocks or administrative login.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { api, clearApiSession, invalidateProjectQueries } from "../../src/components/api.ts";
const root = "http://127.0.0.1:3115",
	nativeFetch = globalThis.fetch,
	jar = new Map(),
	results = [],
	fixture = { prefix: `PERF-S5-${Date.now()}` };
let reads = 0;
if (
	process.env.PM_NETWORK_MODE !== "direct" ||
	new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "rvysclscetfqicpnzlra.supabase.co"
)
	throw Error("WRONG_ISOLATED_TEST");
const accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
globalThis.fetch = async (url, init = {}) => {
	if (typeof url !== "string" || !url.startsWith("/api/")) throw Error("WRONG_API_PATH");
	if ((init.method ?? "GET") === "GET") reads++;
	const headers = new Headers(init.headers);
	headers.set("Cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
	if (init.method && init.method !== "GET") headers.set("Origin", root);
	const response = await nativeFetch(root + url, { ...init, headers });
	for (const cookie of response.headers.getSetCookie()) {
		const pair = cookie.split(";")[0],
			i = pair.indexOf("="),
			k = pair.slice(0, i),
			v = pair.slice(i + 1);
		if (!v || /max-age=0(?:;|$)/i.test(cookie)) jar.delete(k);
		else jar.set(k, v);
	}
	return response;
};
const raw = (url) =>
	globalThis.fetch(url, { cache: "no-store", signal: AbortSignal.timeout(45000) });
async function check(name, fn) {
	try {
		await fn();
		results.push({ name, status: "PASS" });
	} catch (e) {
		results.push({
			name,
			status: "FAIL",
			code: /^[A-Z0-9_]+$/.test(e.code ?? "") ? e.code : "ASSERTION_OR_DEPENDENCY_FAILED",
			...(Number.isInteger(e.status) ? { httpStatus: e.status } : {}),
		});
	}
	console.log(JSON.stringify(results.at(-1)));
}
try {
	await api("/api/auth/login", "POST", accounts.A);
	const p = await api("/api/projects", "POST", {
		name: fixture.prefix,
		description: "有边界缓存独立验证",
	});
	fixture.project = p.id;
	const base = `/api/projects/${p.id}`,
		guest = `/api/guest/projects/${p.id}`;
	await check("actual-api-singleflight-and-default-memory-hit", async () => {
		const n = reads;
		const [a, b] = await Promise.all([api(base), api(base)]);
		assert.equal(a.id, p.id);
		assert.deepEqual(a, b);
		await api(base);
		assert.equal(reads - n, 1);
	});
	await check("actual-api-targeted-event-does-not-clear-unrelated-resource", async () => {
		await api(`${base}/files`);
		const n = reads;
		invalidateProjectQueries(base, [
			{
				kind: "issue.changed",
				entityId: "00000000-0000-4000-8000-000000000001",
				fileId: null,
				sequence: "1",
				revision: 1,
				state: "submitted",
			},
		]);
		await api(`${base}/files`);
		assert.equal(reads, n);
	});
	const link = await api(`${base}/share-links`, "POST", {});
	fixture.shareUrl = link.url;
	await api("/api/guest/session", "POST", {
		token: new URL(link.url).pathname.split("/").at(-1),
	});
	await api(guest);
	await check("revocation-denies-server-read-and-clears-previous-guest-cache", async () => {
		await api(`${base}/share-links/${link.id}`, "DELETE");
		await assert.rejects(
			() => api(guest, "GET", undefined, { cacheMs: 0 }),
			(e) => e.status === 401,
		);
		await assert.rejects(
			() => api(guest),
			(e) => e.status === 401,
		);
	});
	await api("/api/auth/login", "POST", accounts.A);
	let warm;
	for (const candidate of JSON.parse(
		await readFile("tmp/performance-s5/candidates.json", "utf8"),
	)) {
		const url = `/api/projects/${candidate.project}/files/${candidate.file}/preview?variant=640`;
		const response = await raw(url);
		if (response.status !== 200) {
			await response.body?.cancel();
			continue;
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (createHash("sha256").update(bytes).digest("hex") !== candidate.version)
			throw Error("HASH_MISMATCH");
		warm = { url, hash: candidate.version, cold: response.headers.get("server-timing") ?? "" };
		break;
	}
	if (warm)
		await check(
			"real-private-thumbnail-hit-keeps-auth-sql-and-avoids-storage-roundtrip",
			async () => {
				const response = await raw(warm.url),
					bytes = new Uint8Array(await response.arrayBuffer());
				assert.equal(response.status, 200);
				assert.equal(createHash("sha256").update(bytes).digest("hex"), warm.hash);
				assert.match(response.headers.get("cache-control"), /private, no-store/);
				const timing = response.headers.get("server-timing") ?? "";
				assert.match(warm.cold, /storage_sign/);
				assert.doesNotMatch(timing, /storage_(sign|fetch)/);
				assert.match(timing, /auth/);
				assert.match(timing, /sql/);
			},
		);
	else
		results.push({
			name: "real-private-thumbnail-hit",
			status: "PENDING",
			reason: "no-readable-existing-thumbnail-candidate",
		});
	await api(base);
	await api("/api/auth/login", "POST", accounts.B);
	await check("account-switch-rejects-owner-a-cache-and-warmed-private-thumbnail", async () => {
		await assert.rejects(
			() => api(base),
			(e) => e.status === 404,
		);
		if (warm) {
			const response = await raw(warm.url);
			assert.equal(response.status, 404);
			await response.body?.cancel();
		}
	});
} catch (e) {
	results.push({
		name: "setup-or-dependency",
		status: "FAIL",
		code: /^[A-Z0-9_]+$/.test(e.code ?? "") ? e.code : "ASSERTION_OR_DEPENDENCY_FAILED",
		...(Number.isInteger(e.status) ? { httpStatus: e.status } : {}),
	});
} finally {
	globalThis.fetch = nativeFetch;
	clearApiSession();
	jar.clear();
	await mkdir("docs/evidence/performance-s5", { recursive: true });
	const report = {
		checkedAt: new Date().toISOString(),
		environment:
			"actual API module + local production Next + real isolated Supabase; process-direct, TUN/DNS not controlled",
		browserLaunched: false,
		mainlandValidated: false,
		results,
	};
	await writeFile(
		"docs/evidence/performance-s5/client.json",
		`${JSON.stringify(report, null, 2)}\n`,
	);
	await writeFile(
		`docs/evidence/performance-s5/client-${Date.now()}.json`,
		`${JSON.stringify(report, null, 2)}\n`,
	);
	await writeFile("tmp/performance-s5/fixture.json", JSON.stringify(fixture, null, 2), {
		mode: 0o600,
	});
}
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
