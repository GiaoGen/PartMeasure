import { request } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
export const root = process.env.PM_TEST_URL || "http://127.0.0.1:3001";
if (
	root !== "http://127.0.0.1:3001" &&
	!/^https:\/\/partmeasure-staging-[a-z0-9-]+\.vercel\.app$/.test(root)
)
	throw Error("UNAPPROVED_TEST_ORIGIN");
export const accounts = JSON.parse(
	await readFile("tmp/p0-1/test-accounts.json", "utf8"),
);
export const httpFailures = [];
export async function context(actor) {
	const c = await request.newContext({ baseURL: root, timeout: 90000 });
	if (actor)
		await requireData(
			await call(c, "/api/auth/login", "POST", accounts[actor]),
		);
	return c;
}
export async function call(c, path, method = "GET", data, options = {}) {
	const init = { method };
	if (data !== undefined) init.data = data;
	if (method !== "GET") {
		const csrf = await (await c.get("/api/csrf")).json();
		init.headers = {
			origin: root,
			"x-csrf-token": csrf.data.token,
			"Idempotency-Key": options.key ?? randomUUID(),
			...(options.revision ? { "X-PM-Revision": `"${options.revision}"` } : {}),
		};
	}
	const response = await c.fetch(path, init),
		json = (response.headers()["content-type"] ?? "").includes(
			"application/json",
		)
			? await response.json()
			: null;
	if (response.status() >= 400)
		httpFailures.push({
			path,
			method,
			status: response.status(),
			code: json?.error?.code,
			requestId: json?.requestId,
		});
	return {
		status: response.status(),
		data: json?.data,
		code: json?.error?.code,
		response,
	};
}
export function requireData(r, status = 200) {
	if (r.status !== status)
		throw Error(`HTTP_${r.status}_${r.code ?? "UNEXPECTED"}`);
	return r.data;
}
export function safeCode(e) {
	return /^HTTP_\d+_[A-Z_]+$/.test(e.message)
		? e.message
		: /^[0-9A-Z]{5}$/.test(e.code ?? "")
			? e.code
			: e.name;
}
export async function saveReport(name, results, extra = {}) {
	await mkdir("docs/evidence/p0-4", { recursive: true });
	await writeFile(
		`docs/evidence/p0-4/${name}.json`,
		`${JSON.stringify({ checkedAt: new Date().toISOString(), root, realService: true, httpFailures, ...extra, results }, null, 2)}\n`,
	);
}
