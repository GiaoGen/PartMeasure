// HTTP request contexts only. No browser, E2E runner, screenshots or remote DDL.
import { request } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const root = "http://127.0.0.1:3105";
if (
	new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !==
	"rvysclscetfqicpnzlra.supabase.co"
)
	throw Error("WRONG_TEST_PROJECT");
const accounts = JSON.parse(
	await readFile("tmp/p0-1/test-accounts.json", "utf8"),
);
const results = [],
	contexts = [],
	prefix = `ALIGN-${Date.now()}`;
await mkdir("tmp/backend-alignment", { recursive: true });
await mkdir("docs/evidence/backend-alignment", { recursive: true });
async function context(account) {
	const c = await request.newContext({ baseURL: root, timeout: 90000 });
	contexts.push(c);
	if (account)
		data(await call(c, "/api/auth/login", "POST", accounts[account]));
	return c;
}
async function call(c, path, method = "GET", body, key = randomUUID()) {
	const headers = {};
	if (method !== "GET") {
		const csrf = await (await c.get("/api/csrf")).json();
		Object.assign(headers, {
			origin: root,
			"x-csrf-token": csrf.data.token,
			"Idempotency-Key": key,
		});
	}
	const r = await c.fetch(path, {
		method,
		headers,
		...(body === undefined ? {} : { data: body }),
	});
	const json = (r.headers()["content-type"] ?? "").includes("application/json")
		? await r.json()
		: null;
	return { status: r.status(), data: json?.data, code: json?.error?.code };
}
function data(r, status = 200) {
	assert.equal(r.status, status, `HTTP_${r.status}_${r.code ?? "UNKNOWN"}`);
	return r.data;
}
async function check(name, work) {
	try {
		await work();
		results.push({ check: name, status: "PASS" });
	} catch (error) {
		results.push({
			check: name,
			status: "FAIL",
			code: /^[0-9A-Z_]+$/.test(error.code ?? "") ? error.code : error.name,
		});
	}
	process.stdout.write(`${name}: ${results.at(-1).status}\n`);
	await writeFile(
		"docs/evidence/backend-alignment/api-progress.json",
		JSON.stringify(
			{ checkedAt: new Date().toISOString(), root, results },
			null,
			2,
		),
	);
}
let fixtures;
try {
	const A = await context("A"),
		B = await context("B"),
		G = await context();
	const key = randomUUID(),
		body = {
			name: `${prefix}-rose`,
			color: "rose",
			description: "后端对齐隔离夹具",
		};
	const fa = data(
		await call(A, "/api/project-folders", "POST", body, key),
		201,
	);
	const fb = data(await call(B, "/api/project-folders", "POST", body), 201);
	await check(
		"real-password-auth-folder-save-replay-and-A-B-isolation",
		async () => {
			assert.equal(
				data(await call(A, "/api/project-folders", "POST", body, key), 201).id,
				fa.id,
			);
			assert.equal(
				(await call(A, "/api/project-folders", "POST", body)).code,
				"FOLDER_NAME_EXISTS",
			);
			assert.equal(
				data(await call(A, "/api/project-folders")).items.some(
					(f) => f.id === fb.id,
				),
				false,
			);
		},
	);
	await check(
		"folder-boundary-validation-reserved-name-and-permission",
		async () => {
			for (const invalid of [
				{ name: "全部" },
				{ name: " " },
				{ name: "x".repeat(61) },
				{ name: "ok", color: "yellow" },
				{ name: "ok", description: "x".repeat(501) },
				{ name: "ok", ownerId: randomUUID() },
			])
				assert.equal(
					(await call(A, "/api/project-folders", "POST", invalid)).status,
					422,
				);
			assert.equal((await call(G, "/api/project-folders")).status, 401);
			assert.equal((await call(G, "/api/guest/project-folders")).status, 403);
		},
	);
	const projectBody = {
			name: `${prefix}-00`,
			description: "Needle 中文 100%_literal",
			folderId: fa.id,
		},
		projectKey = randomUUID();
	const project = data(
		await call(A, "/api/projects", "POST", projectBody, projectKey),
		201,
	);
	fixtures = { prefix, projectId: project.id, folderA: fa.id, folderB: fb.id };
	await writeFile(
		"tmp/backend-alignment/api-fixture.json",
		JSON.stringify(fixtures, null, 2),
	);
	await check(
		"create-classification-atomic-replay-detail-color-and-owner-denial",
		async () => {
			assert.equal(
				data(
					await call(A, "/api/projects", "POST", projectBody, projectKey),
					201,
				).id,
				project.id,
			);
			assert.equal(
				data(await call(A, `/api/projects/${project.id}`)).folder.color,
				"rose",
			);
			assert.equal(
				(
					await call(A, "/api/projects", "POST", {
						name: `${prefix}-forbidden`,
						description: "",
						folderId: fb.id,
					})
				).status,
				404,
			);
			assert.equal(
				data(await call(A, `/api/projects?q=${prefix}-forbidden`)).counts
					.searchMatchCount,
				0,
			);
			assert.equal((await call(B, `/api/projects/${project.id}`)).status, 404);
		},
	);
	for (let i = 1; i < 33; i++)
		data(
			await call(A, "/api/projects", "POST", {
				name: `${prefix}-${i.toString().padStart(2, "0")}`,
				description: "",
				folderId: fa.id,
			}),
			201,
		);
	await check("cloud-global-search-beyond-30-and-exact-counts", async () => {
		const first = data(await call(A, `/api/projects?folderId=${fa.id}`));
		assert.equal(first.items.length, 30);
		assert.equal(first.counts.folderCount, 33);
		assert.equal(first.counts.searchMatchCount, 33);
		const second = data(
			await call(
				A,
				`/api/projects?folderId=${fa.id}&cursor=${first.nextCursor}`,
			),
		);
		assert.equal(second.items.length, 3);
		assert.equal(
			new Set([...first.items, ...second.items].map((p) => p.id)).size,
			33,
		);
		const found = data(
			await call(
				A,
				`/api/projects?folderId=${fa.id}&q=${encodeURIComponent(" needle 中文 ")}`,
			),
		);
		assert.equal(found.items[0].id, project.id);
		assert.equal(found.counts.searchMatchCount, 1);
		assert.equal(found.counts.folderCount, 33);
		assert.equal(
			data(
				await call(
					A,
					`/api/projects?folderId=${fa.id}&q=${encodeURIComponent("%_")}`,
				),
			).items.length,
			1,
		);
		assert.equal(
			data(await call(A, "/api/project-folders")).items.find(
				(f) => f.id === fa.id,
			).projectCount,
			33,
		);
		assert.equal(
			(
				await call(
					A,
					`/api/projects?folderId=${fa.id}&q=other&cursor=${first.nextCursor}`,
				)
			).code,
			"CURSOR_INVALID",
		);
		assert.equal(
			(await call(B, `/api/projects?cursor=${first.nextCursor}`)).code,
			"CURSOR_INVALID",
		);
	});
	await check(
		"query-boundaries-and-upload-policy-effective-format-limits",
		async () => {
			for (const query of [
				"folderId=",
				"q=a&q=b",
				"sort=wrong",
				"unknown=1",
				`folderId=${fb.id}`,
			])
				assert.ok(
					[404, 422].includes((await call(A, `/api/projects?${query}`)).status),
				);
			const policy = data(await call(G, "/api/upload-policy"));
			assert.equal(policy.maxBatchFiles, 20);
			assert.equal(policy.formats.length, 13);
			assert.equal(policy.processing.required, true);
			assert.ok(
				policy.formats.every(
					(format) => format.maxFileBytes <= policy.maxFileBytes,
				),
			);
		},
	);
	const share = data(
		await call(A, `/api/projects/${project.id}/share-links`, "POST", {}),
		201,
	);
	data(
		await call(G, "/api/guest/session", "POST", {
			token: share.url.split("/").at(-1),
		}),
	);
	await check(
		"real-Guest-no-private-classification-management-and-revocation",
		async () => {
			const guestProject = data(
				await call(G, `/api/guest/projects/${project.id}`),
			);
			assert.equal(Object.hasOwn(guestProject, "folderId"), false);
			assert.equal(Object.hasOwn(guestProject, "folder"), false);
			assert.equal(
				(await call(G, "/api/guest/project-folders", "POST", body)).status,
				403,
			);
			data(
				await call(
					A,
					`/api/projects/${project.id}/share-links/${share.id}`,
					"DELETE",
				),
			);
			assert.equal(
				(await call(G, `/api/guest/projects/${project.id}`)).status,
				401,
			);
		},
	);
	await check(
		"existing-cloud-material-summaries-and-annotation-filter-read-only",
		async () => {
			const prior = JSON.parse(await readFile("tmp/p0-4/browser-fixture.json", "utf8"));
			const existing = data(
				await call(A, `/api/projects/${prior.projectA}/files`),
			).items.find((f) => f.annotationSummary?.count > 0);
			assert.ok(existing);
			assert.equal(typeof existing.byteSize, "string");
			assert.equal(typeof existing.previewVersion, "string");
			const document = data(
				await call(
					A,
					`/api/projects/${prior.projectA}/files/${existing.id}/annotations`,
				),
			);
			const annotationId = document.items.find((a) => !a.deleted)?.id;
			assert.ok(annotationId);
			const filtered = data(
				await call(
					A,
					`/api/projects/${prior.projectA}/files/${existing.id}/issues?annotationId=${annotationId}`,
				),
			);
			assert.equal(filtered.filterScope, "annotation");
			assert.equal(filtered.countScope, "project");
			assert.ok(filtered.items.length > 0);
			assert.ok(
				filtered.items.every(
					(issue) => issue.annotationRef?.id === annotationId,
				),
			);
			assert.equal(
				(
					await call(
						B,
						`/api/projects/${prior.projectA}/files/${existing.id}/issues?annotationId=${annotationId}`,
					)
				).status,
				404,
			);
		},
	);
} catch (error) {
	results.push({
		check: "remaining-checks-interrupted",
		status: "FAIL",
		code: error.name,
	});
	process.stdout.write("remaining-checks-interrupted: FAIL\n");
} finally {
	for (const c of contexts) await c.dispose();
	await writeFile(
		"docs/evidence/backend-alignment/api.json",
		`${JSON.stringify({ checkedAt: new Date().toISOString(), root, database: "Supabase rvysclscetfqicpnzlra", realPasswordLogin: true, browserLaunched: false, registrationOTP: "not tested", fixturePrefix: prefix, results }, null, 2)}\n`,
	);
}
if (results.some((r) => r.status !== "PASS")) process.exitCode = 1;
