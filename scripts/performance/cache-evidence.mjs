// Read-only existing evidence query check through normal authentication; no browser.
import { request } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const root = "http://127.0.0.1:3115",
	clients = [],
	results = [];
if (
	process.env.PM_NETWORK_MODE !== "direct" ||
	new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "rvysclscetfqicpnzlra.supabase.co"
)
	throw Error("WRONG_ISOLATED_TEST");
try {
	const accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8")),
		candidates = JSON.parse(await readFile("tmp/performance-s5/issue-candidates.json", "utf8"));
	let checked = false;
	for (const account of [accounts.A, accounts.B]) {
		const c = await request.newContext({ baseURL: root, timeout: 45000 });
		clients.push(c);
		const csrf = await (await c.get("/api/csrf")).json();
		const login = await c.post("/api/auth/login", {
			data: account,
			headers: {
				Origin: root,
				"x-csrf-token": csrf.data.token,
				"Idempotency-Key": randomUUID(),
			},
		});
		assert.equal(login.status(), 200);
		for (const f of candidates) {
			const res = await c.get(`/api/projects/${f.project}/issues/${f.issue}`);
			if (res.status() === 404) continue;
			assert.equal(res.status(), 200);
			const detail = (await res.json()).data,
				images = detail.responses
					.flatMap((r) => r.attachments)
					.filter((f) => f.mime === "image/webp");
			assert.ok(
				images.length > 0 &&
					images.every(
						(f) =>
							/^[a-f0-9]{64}$/.test(f.previewVersion) &&
							(f.thumbnail === null || /^[a-f0-9]{64}$/.test(f.thumbnail?.version)),
					),
			);
			checked = true;
			break;
		}
		if (checked) break;
	}
	results.push({
		name: "actual-evidence-DTO-content-version-and-optional-thumbnail",
		status: checked ? "PASS" : "PENDING",
	});
} catch {
	results.push({
		name: "actual-evidence-DTO-content-version-and-same-project-thumbnail-join",
		status: "FAIL",
		code: "ASSERTION_OR_DEPENDENCY_FAILED",
	});
} finally {
	await Promise.allSettled(clients.map((c) => c.dispose()));
	await writeFile(
		"docs/evidence/performance-s5/evidence-metadata.json",
		`${JSON.stringify(
			{
				checkedAt: new Date().toISOString(),
				realService: true,
				browserLaunched: false,
				readOnlyExistingData: true,
				results,
			},
			null,
			2,
		)}\n`,
	);
	console.log(JSON.stringify(results));
}
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
