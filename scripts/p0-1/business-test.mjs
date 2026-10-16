import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { request } from "@playwright/test";
import sharp from "sharp";
const baseURL = "http://127.0.0.1:3000",
	results = [];
await mkdir("docs/evidence/p0-1", { recursive: true });
const contexts = [];
async function context(actor) {
	const c = await request.newContext({
		baseURL,
		...(actor ? { storageState: `tmp/p0-1/owner-${actor}.json` } : {}),
	});
	contexts.push(c);
	return c;
}
async function call(
	c,
	url,
	method = "GET",
	data,
	key = randomUUID(),
	revision,
) {
	const options = {};
	if (method !== "GET") {
		const csrf = await (await c.get("/api/csrf")).json();
		options.headers = {
			origin: baseURL,
			"x-csrf-token": csrf.data.token,
			"Idempotency-Key": key,
			...(revision ? { "If-Match": `"${revision}"` } : {}),
		};
	}
	if (data !== undefined) options.data = data;
	const response = await c.fetch(url, { method, ...options });
	const type = response.headers()["content-type"] ?? "";
	const json = type.includes("application/json") ? await response.json() : null;
	return {
		status: response.status(),
		data: json?.data,
		error: json?.error?.code,
		response,
	};
}
async function check(name, work) {
	try {
		await work();
		results.push({ check: name, status: "PASS" });
	} catch {
		results.push({ check: name, status: "FAIL" });
	}
	process.stdout.write(`${name}: ${results.at(-1).status}\n`);
}
async function requireData(result, status = 200) {
	assert.equal(result.status, status);
	return result.data;
}
async function upload(c, p, filename, bytes, mime) {
	const input = {
		filename,
		byteSize: bytes.length,
		declaredMime: mime,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
	const root = `/api/${p.guest ? "guest/" : ""}projects/${p.id}`;
	const key = randomUUID(),
		r = await requireData(
			await call(c, `${root}/uploads`, "POST", input, key),
			201,
		);
	const again = await requireData(
		await call(c, `${root}/uploads`, "POST", input, key),
		201,
	);
	assert.equal(r.id, again.id);
	const grant = await requireData(
		await call(c, `${root}/uploads/${r.id}/grant`, "POST", {}),
	);
	if (!grant.state) {
		const response = await fetch(grant.signedUrl, {
			method: "PUT",
			headers: { "Content-Type": mime },
			body: bytes,
		});
		assert.ok(response.ok);
	}
	const completeKey = randomUUID();
	assert.equal(
		(await call(c, `${root}/uploads/${r.id}/complete`, "POST", {}, completeKey))
			.status,
		202,
	);
	assert.equal(
		(await call(c, `${root}/uploads/${r.id}/complete`, "POST", {}, completeKey))
			.status,
		202,
	);
	return { id: r.id, root, input };
}
async function wait(c, upload, state = "ready") {
	for (let i = 0; i < 25; i++) {
		const r = await call(c, `${upload.root}/uploads/${upload.id}`);
		if (r.data?.state === state) return r.data;
		if (r.data?.state === "rejected" && state !== "rejected")
			throw new Error("REJECTED");
		await new Promise((r) => setTimeout(r, 1500));
	}
	throw new Error("PROCESSING_TIMEOUT");
}
let a, b, g, pa, pb, activeShare;
try {
	a = await context("A");
	b = await context("B");
	g = await context();
	const key = randomUUID(),
		input = {
			name: "P0-1 权限验证 A",
			description: "隔离测试资料；非真实客户数据。",
		};
	pa = await requireData(
		await call(a, "/api/projects", "POST", input, key),
		201,
	);
	pb = await requireData(
		await call(b, "/api/projects", "POST", {
			name: "P0-1 权限验证 B",
			description: "B 私有项目",
		}),
		201,
	);
	await check("project-create-idempotent", async () => {
		assert.equal(
			(
				await requireData(
					await call(a, "/api/projects", "POST", input, key),
					201,
				)
			).id,
			pa.id,
		);
		assert.equal(
			(
				await call(
					a,
					"/api/projects",
					"POST",
					{ ...input, name: "conflict" },
					key,
				)
			).status,
			409,
		);
	});
	await check("owners-isolated", async () => {
		assert.equal((await call(b, `/api/projects/${pa.id}`)).status, 404);
		assert.equal((await call(a, `/api/projects/${pb.id}`)).status, 404);
		assert.ok(
			!(await requireData(await call(b, "/api/projects"))).items.some(
				(p) => p.id === pa.id,
			),
		);
	});
	await check("project-edit-revision-and-persistence", async () => {
		const edited = await requireData(
			await call(
				a,
				`/api/projects/${pa.id}`,
				"PATCH",
				{ name: "安装板 · P0-1 验证", description: input.description },
				randomUUID(),
				1,
			),
		);
		assert.equal(edited.revision, 2);
		assert.equal(
			(await call(a, `/api/projects/${pa.id}`, "PATCH", input, randomUUID(), 1))
				.status,
			409,
		);
		assert.equal(
			(await requireData(await call(a, `/api/projects/${pa.id}`))).name,
			edited.name,
		);
	});
	activeShare = await requireData(
		await call(a, `/api/projects/${pa.id}/share-links`, "POST", {}),
		201,
	);
	const raw = activeShare.url.split("/").pop();
	await requireData(
		await call(g, "/api/guest/session", "POST", { token: raw }),
	);
	await check("guest-no-account-and-refresh-restore", async () => {
		const state = await g.storageState();
		assert.ok(!state.cookies.some((c) => c.name.startsWith("sb-")));
		await g.storageState({ path: "tmp/p0-1/guest.json" });
		const fresh = await request.newContext({
			baseURL,
			storageState: "tmp/p0-1/guest.json",
		});
		assert.equal(
			(await fresh.get(`/api/guest/projects/${pa.id}`)).status(),
			200,
		);
		await fresh.dispose();
	});
	await check("guest-denied-management-and-cross-project", async () => {
		assert.equal(
			(await call(g, `/api/guest/projects/${pa.id}/share-links`, "POST", {}))
				.status,
			403,
		);
		assert.equal(
			(await call(g, `/api/projects/${pa.id}/share-links`, "POST", {})).status,
			401,
		);
		assert.equal((await call(g, `/api/guest/projects/${pb.id}`)).status, 401);
		assert.equal(
			(
				await call(
					g,
					`/api/guest/projects/${pa.id}`,
					"PATCH",
					input,
					randomUUID(),
					2,
				)
			).status,
			403,
		);
	});
	let ownerUpload, guestUpload, bUpload;
	await check(
		"owner-real-private-image-upload-and-idempotent-complete",
		async () => {
			ownerUpload = await upload(
				a,
				pa,
				"plate.jpg",
				await readFile(
					"experiments/konva/public/fixtures/640x480-o6-source.jpg",
				),
				"image/jpeg",
			);
			await wait(a, ownerUpload);
		},
	);
	await check("guest-real-private-attachment-upload", async () => {
		guestUpload = await upload(
			g,
			{ ...pa, guest: true },
			"drawing.step",
			Buffer.from(
				"ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;",
			),
			"application/octet-stream",
		);
		await wait(g, guestUpload);
	});
	await check("other-owner-upload", async () => {
		bUpload = await upload(
			b,
			pb,
			"other.jpg",
			await readFile("experiments/konva/public/fixtures/480x640-o2-source.jpg"),
			"image/jpeg",
		);
		await wait(b, bUpload);
	});
	await check("standard-image-preview-and-owner-original", async () => {
		assert.ok(ownerUpload);
		const r = await call(
			g,
			`/api/guest/projects/${pa.id}/files/${ownerUpload.id}/preview`,
		);
		assert.equal(r.status, 200);
		const meta = await sharp(await r.response.body()).metadata();
		assert.equal(meta.width, 640);
		assert.equal(meta.height, 480);
		assert.equal(meta.exif, undefined);
		assert.equal(meta.orientation, undefined);
		assert.equal(
			(
				await call(
					g,
					`/api/guest/projects/${pa.id}/files/${ownerUpload.id}/download?original=1`,
				)
			).status,
			403,
		);
		assert.equal(
			(
				await call(
					a,
					`/api/projects/${pa.id}/files/${ownerUpload.id}/download?original=1`,
				)
			).status,
			200,
		);
	});
	await check("cross-project-file-download-refused", async () => {
		assert.equal(
			(await call(a, `/api/projects/${pa.id}/files/${bUpload.id}/download`))
				.status,
			404,
		);
		assert.equal(
			(
				await call(
					g,
					`/api/guest/projects/${pa.id}/files/${bUpload.id}/download`,
				)
			).status,
			404,
		);
	});
	await check("authorized-download-range-and-canonical-name", async () => {
		const path=`/api/guest/projects/${pa.id}/files/${ownerUpload.id}/download`;
		const full=await g.get(path);
		assert.equal(full.status(),200);
		assert.match(full.headers()['content-disposition'],/plate.webp/);
		const first=await g.get(path,{headers:{Range:'bytes=0-15'}});
		assert.equal(first.status(),206);
		assert.deepEqual(await first.body(),(await full.body()).subarray(0,16));
		assert.equal((await g.get(path,{headers:{Range:'bytes=0-1,3-4'}})).status(),416);
		assert.equal((await g.get(path,{headers:{Range:'bytes=999999999-'}})).status(),416);
	});
	await check("private-buckets-public-url-refused", async () => {
		const config = JSON.parse(
			await readFile("tmp/p0-0-cloud/config.json", "utf8"),
		);
		for (const bucket of ["partmeasure-private", "partmeasure-quarantine"]) {
			const r = await fetch(
				`${config.url}/storage/v1/object/public/${bucket}/${pa.id}/${ownerUpload.id}/source`,
			);
			assert.ok(!r.ok);
		}
	});
	await check("format-size-and-mime-rejected", async () => {
		const root = `/api/guest/projects/${pa.id}/uploads`,
			sha = "a".repeat(64);
		for (const file of [
			{ filename: "photo.heic", byteSize: 10, declaredMime: "image/heic" },
			{
				filename: "huge.jpg",
				byteSize: 20 * 1024 * 1024 + 1,
				declaredMime: "image/jpeg",
			},
			{ filename: "fake.png", byteSize: 10, declaredMime: "image/jpeg" },
			{
				filename: "huge.step",
				byteSize: 50 * 1024 * 1024 + 1,
				declaredMime: "application/octet-stream",
			},
		])
			assert.ok(
				[413, 415].includes(
					(await call(g, root, "POST", { ...file, sha256: sha })).status,
				),
			);
	});
	await check("disguised-file-quarantined-not-readable", async () => {
		const bad = await upload(
			g,
			{ ...pa, guest: true },
			"fake.jpg",
			Buffer.from("MZ not an image"),
			"image/jpeg",
		);
		await wait(g, bad, "rejected");
		assert.equal(
			(await call(g, `/api/guest/projects/${pa.id}/files/${bad.id}/download`))
				.status,
			404,
		);
	});
	await check("guest-cannot-soft-delete", async () => {
		assert.equal(
			(
				await call(
					g,
					`/api/guest/projects/${pa.id}/files/${guestUpload.id}`,
					"DELETE",
				)
			).status,
			403,
		);
	});
	await check("owner-soft-delete-hidden-and-retained", async () => {
		assert.equal(
			(
				await call(
					a,
					`/api/projects/${pa.id}/files/${guestUpload.id}`,
					"DELETE",
				)
			).status,
			200,
		);
		assert.ok(
			!(
				await requireData(await call(g, `/api/guest/projects/${pa.id}/files`))
			).items.some((f) => f.id === guestUpload.id),
		);
		assert.equal(
			(await call(a, `/api/projects/${pa.id}/files/${guestUpload.id}/download`))
				.status,
			404,
		);
	});
	await check("revoke-invalidates-link-session-and-finalize", async () => {
		const pending = await requireData(
			await call(g, `/api/guest/projects/${pa.id}/uploads`, "POST", {
				filename: "later.pdf",
				byteSize: 50,
				declaredMime: "application/pdf",
				sha256: "b".repeat(64),
			}),
			201,
		);
		assert.equal(
			(
				await call(
					a,
					`/api/projects/${pa.id}/share-links/${activeShare.id}`,
					"DELETE",
				)
			).status,
			200,
		);
		assert.equal(
			(
				await call(
					g,
					`/api/guest/projects/${pa.id}/uploads/${pending.id}/complete`,
					"POST",
					{},
				)
			).status,
			401,
		);
		assert.equal(
			(
				await call(
					g,
					`/api/guest/projects/${pa.id}/files/${ownerUpload.id}/download`,
				)
			).status,
			401,
		);
		const fresh = await context();
		assert.equal(
			(await call(fresh, "/api/guest/session", "POST", { token: raw })).status,
			401,
		);
	});
	activeShare = await requireData(
		await call(a, `/api/projects/${pa.id}/share-links`, "POST", {}),
		201,
	);
	await requireData(
		await call(g, "/api/guest/session", "POST", {
			token: activeShare.url.split("/").pop(),
		}),
	);
	await g.storageState({ path: "tmp/p0-1/guest.json" });
	await writeFile(
		"tmp/p0-1/business-fixtures.json",
		JSON.stringify({
			projectA: pa.id,
			projectB: pb.id,
			shareUrl: activeShare.url,
			ownerFile: ownerUpload?.id,
		}),
	);
	await check("logout-invalidates-current-cookie", async () => {
		const temp = await context("B");
		assert.equal(
			(await call(temp, "/api/auth/logout", "POST", {})).status,
			200,
		);
		assert.equal((await call(temp, "/api/auth/session")).status, 401);
	});
} catch {
	results.push({ check: "business-suite-prerequisite", status: "FAIL" });
} finally {
	for (const c of contexts) await c.dispose();
}
await writeFile(
	"docs/evidence/p0-1/business.json",
	`${JSON.stringify({ checkedAt: new Date().toISOString(), authSetup: "admin fixtures explicitly authorized; OTP deferred", results }, null, 2)}\n`,
);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
