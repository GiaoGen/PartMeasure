// Current-source connection evidence. No browser, mail, admin DB, network changes or cleanup.
import nextEnv from "@next/env";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import https from "node:https";
import { AppError } from "../../src/lib/policy";
import { getPool, transaction } from "../../src/lib/server/db";
import { SessionNotifications } from "../../src/lib/server/session-notifications";
import { connectionFailure, connectionMode, connectionTarget, isolatedRef, signedUploadTarget } from "./connection-model";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const run = randomUUID();
const results: object[] = [];
let stage = "configuration";
let failed = false;
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const must = (ok: unknown, code: string) => { if (!ok) throw new AppError(code); };
async function source() {
	const files = ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", ".env.example"];
	async function walk(dir: string) {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const file = `${dir}/${entry.name}`;
			if (entry.isDirectory()) await walk(file);
			else if (entry.isFile()) files.push(file);
		}
	}
	for (const dir of ["src", "supabase/migrations", "scripts/maintenance"]) await walk(dir);
	const manifest = [];
	for (const path of files.sort()) manifest.push({ path, sha256: sha256(await readFile(path)) });
	return { digest: sha256(JSON.stringify(manifest)), files: manifest };
}
async function check<T>(name: string, work: () => Promise<T>): Promise<T> {
	stage = name;
	const start = performance.now();
	try {
		const value = await work();
		results.push({ name, status: "PASS", milliseconds: Math.round(performance.now() - start) });
		console.log(JSON.stringify({ event: "connection_stage", ...results.at(-1) }));
		return value;
	} catch (error) {
		failed = true;
		results.push({ name, status: "NOT_PASSED", milliseconds: Math.round(performance.now() - start), ...connectionFailure(error) });
		console.log(JSON.stringify({ event: "connection_stage", ...results.at(-1) }));
		throw error; // Never repeat the same failed operation or proceed to dependent writes.
	}
}
function apiClient(root: string) {
	const jar = new Map<string, string>();
	let csrf: string | undefined;
	async function raw(path: string, method = "GET", data?: unknown): Promise<Response> {
		must(path.startsWith("/api/") && !path.includes(".."), "INVALID_API_PATH");
		if (method !== "GET" && !csrf) csrf = (await json<{ token: string }>("/api/csrf")).token;
		const response = await fetch(`${root}${path}`, {
			method, redirect: "error", signal: AbortSignal.timeout(75000),
			headers: {
				cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
				...(method === "GET" ? {} : { origin: root, "x-csrf-token": csrf ?? "", "Idempotency-Key": randomUUID(), "Content-Type": "application/json" }),
			},
			...(data === undefined ? {} : { body: JSON.stringify(data) }),
		});
		for (const cookie of response.headers.getSetCookie()) {
			const pair = cookie.split(";")[0] ?? "", at = pair.indexOf("=");
			if (at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1));
		}
		return response;
	}
	async function json<T>(path: string, method = "GET", data?: unknown): Promise<T> {
		const response = await raw(path, method, data);
		// Do not copy response data/errors into evidence. Only stage and HTTP status leave this process.
		if (!response.ok) { await response.body?.cancel(); throw new AppError("API_REQUEST_FAILED", response.status); }
		return (await response.json()).data as T;
	}
	return { raw, json, clear() { jar.clear(); csrf = undefined; } };
}
async function download(client: ReturnType<typeof apiClient>, base: string, id: string, expectedHash: string, expectedBytes: number, original: boolean) {
	const response = await client.raw(`${base}/files/${id}/download${original ? "?original=1" : ""}`);
	if (response.status !== 200) { await response.body?.cancel(); throw new AppError("PRIVATE_DOWNLOAD_FAILED", response.status); }
	must(response.headers.get("cache-control")?.includes("no-store"), "PRIVATE_CACHE_POLICY_FAILED");
	const hash = createHash("sha256");
	let bytes = 0;
	for await (const part of response.body ?? []) {
		bytes += part.length;
		if (bytes > expectedBytes || bytes > 2 * 1024 * 1024) throw new AppError("PRIVATE_BYTE_LIMIT");
		hash.update(part);
	}
	must(bytes === expectedBytes && hash.digest("hex") === expectedHash, "PRIVATE_HASH_MISMATCH");
	return { bytes, sha256: expectedHash };
}
async function apiEvidence(root: string, write: boolean) {
	const accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
	const A = apiClient(root), B = apiClient(root);
	try {
		await check("owner_a_password_login", () => A.json("/api/auth/login", "POST", accounts.A));
		await check("owner_a_verified_session", async () => must((await A.json<{ authenticated: boolean }>("/api/auth/session")).authenticated, "AUTH_REQUIRED"));
		await check("owner_a_project_list", () => A.json("/api/projects"));
		let projectId: string, fileId: string, expectedHash: string, expectedBytes: number;
		if (write) {
			// Always a new synthetic project. No argument can target existing data for writes.
			const project = await check("synthetic_project_create", () => A.json<{ id: string }>("/api/projects", "POST", { name: `FIX-A-${run}`, description: "合成连接验证；保留供后续复用，无自动删除" }));
			projectId = project.id;
			await mkdir("tmp/fix-a", { recursive: true });
			await writeFile(`tmp/fix-a/${run}.json`, JSON.stringify({ projectId }), { flag: "wx" });
			const base = `/api/projects/${projectId}`;
			const bytes = Buffer.from("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('FIX-A synthetic connection sample'),'2;1');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
			expectedHash = sha256(bytes); expectedBytes = bytes.length;
			const reservation = await check("private_attachment_reserve", () => A.json<{ id: string }>(`${base}/uploads`, "POST", { filename: "fix-a-synthetic.step", byteSize: expectedBytes, sha256: expectedHash, declaredMime: "application/octet-stream", purpose: "delivery" }));
			fileId = reservation.id;
			await writeFile(`tmp/fix-a/${run}.json`, JSON.stringify({ projectId, fileId, sha256: expectedHash, bytes: expectedBytes }));
			const grant = await check("private_upload_grant", () => A.json<{ signedUrl: string }>(`${base}/uploads/${fileId}/grant`, "POST"));
			await check("synthetic_private_upload", async () => {
				const response = await fetch(signedUploadTarget(grant.signedUrl), { method: "PUT", body: bytes, headers: { "Content-Type": "application/octet-stream" }, signal: AbortSignal.timeout(60000), redirect: "error" });
				await response.body?.cancel(); must(response.ok, "PRIVATE_UPLOAD_FAILED");
			});
			await check("private_upload_complete_without_worker", async () => must((await A.json<{ state: string }>(`${base}/uploads/${fileId}/complete`, "POST", {})).state === "ready", "PRIVATE_UPLOAD_NOT_READY"));
		} else {
			const fixture = JSON.parse(await readFile("tmp/p0-4/fixture.json", "utf8"));
			projectId = fixture.projectA; fileId = fixture.material.id;
			expectedHash = fixture.material.sha256; expectedBytes = fixture.material.bytes;
		}
		const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
		must(uuid.test(projectId) && uuid.test(fileId) && /^[0-9a-f]{64}$/.test(expectedHash) &&
			Number.isSafeInteger(expectedBytes) && expectedBytes > 0 && expectedBytes <= 2 * 1024 * 1024, "INVALID_SYNTHETIC_FIXTURE");
		const base = `/api/projects/${projectId}`;
		await check("owner_a_project_detail", () => A.json(base));
		await check("owner_a_file_list", () => A.json(`${base}/files${write ? "?purpose=delivery" : ""}`));
		// The legacy fixture records uploaded source bytes; photos' default downloads are normalized WebP.
		const bytes = await check("private_bytes_hash", () => download(A, base, fileId, expectedHash, expectedBytes, !write));
		results.push({ name: "private_bytes_evidence", ...bytes, variant: write ? "attachment" : "original", synthetic: true });
		await check("owner_b_password_login", () => B.json("/api/auth/login", "POST", accounts.B));
		for (const [name, path] of [["other_owner_project_denied", base], ["other_owner_private_bytes_denied", `${base}/files/${fileId}/download`]] as const) {
			await check(name, async () => { const response = await B.raw(path); await response.body?.cancel(); must(response.status === 404, "OWNER_ISOLATION_FAILED"); });
		}
	} finally { A.clear(); B.clear(); }
}
async function main() {
	const mode = connectionMode(process.argv.slice(2));
	const before = await source();
	const report = {
		checkedAt: new Date().toISOString(), run, mode, projectRef: isolatedRef,
		node: process.versions.node, source: before,
		scope: "Current local development source + real isolated dependencies. HTTP only; no browser/OTP/mail/mainland phone/hosted acceptance. API reads update normal rate counters; password login creates normal Auth sessions.",
		network: { changed: false, osTunProxyState: "not-controlled-or-certified-absent", nodeEnvProxyEnabled: process.env.NODE_USE_ENV_PROXY === "1" },
		businessWritesRequested: mode === "write", results,
	};
	try {
		const target = await check("configuration", async () => connectionTarget(process.env, mode === "read" || mode === "write"));
		if (mode === "probe") {
			await check("auth_settings_https", () => new Promise<void>((resolve, reject) => {
				const request = https.get(new URL("/auth/v1/settings", target.origin), { rejectUnauthorized: true, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" } }, response => {
					response.resume(); response.once("error", reject);
					response.once("end", () => { clearTimeout(timer); response.statusCode === 200 ? resolve() : reject(new AppError("AUTH_SETTINGS_FAILED", response.statusCode)); });
				});
				const timer = setTimeout(() => request.destroy(new AppError("HTTPS_PROBE_TIMEOUT")), 12000);
				request.once("error", error => { clearTimeout(timer); reject(error); });
			}));
			await check("restricted_runtime_verified_tls_select", () => transaction(null, async db => must((await db.query("select current_user as role")).rows[0]?.role === "partmeasure_runtime", "UNSAFE_DATABASE_ROLE")));
			await check("restricted_session_listen", async () => {
				const notifications = new SessionNotifications("pm_project_events");
				try { const off = await notifications.subscribe({ change() {}, dropped() {} }); off(); }
				finally { notifications.stop(); }
			});
		}
		if (mode === "read" || mode === "write") await apiEvidence(target.root, mode === "write");
		await check("source_unchanged_during_run", async () => must((await source()).digest === before.digest, "SOURCE_CHANGED_REPEAT_AFFECTED_CHECKS"));
	} catch (error) {
		if (!failed) { failed = true; results.push({ name: stage, status: "NOT_PASSED", ...connectionFailure(error) }); }
	} finally {
		if (mode === "probe") try { await getPool().end(); } catch { /* Configuration may fail before a pool exists. */ }
		await mkdir("docs/evidence/fix-a", { recursive: true });
		const file = `docs/evidence/fix-a/${mode}-${run}.json`;
		await writeFile(file, `${JSON.stringify({ ...report, status: failed ? "NOT_PASSED" : "PASS" }, null, 2)}\n`, { flag: "wx" });
		console.log(JSON.stringify({ report: file, status: failed ? "NOT_PASSED" : "PASS", mode, sourceDigest: before.digest, results }));
		if (failed) process.exitCode = 1;
	}
}
main().catch(() => { console.error("CONNECTION_CHECK_SETUP_FAILED (details redacted)"); process.exitCode = 1; });
