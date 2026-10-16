import { request } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
export const root = "http://127.0.0.1:3000";
export async function context(actor) {
	const c = await request.newContext({ baseURL: root, timeout: 60000 });
	if (actor) {
		const accounts = JSON.parse(
			await readFile("tmp/p0-1/test-accounts.json", "utf8"),
		);
		await requireData(
			await call(c, "/api/auth/login", "POST", accounts[actor]),
		);
	}
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
			...(options.revision ? { "If-Match": `"${options.revision}"` } : {}),
		};
	}
	const response = await c.fetch(path, init),
		json = (response.headers()["content-type"] ?? "").includes(
			"application/json",
		)
			? await response.json()
			: null;
	return {
		status: response.status(),
		data: json?.data,
		code: json?.error?.code,
		response,
	};
}
export async function requireData(result, expected = 200) {
	if (result.status !== expected)
		throw new Error(`HTTP_${result.status}_${result.code ?? "UNEXPECTED"}`);
	return result.data;
}
