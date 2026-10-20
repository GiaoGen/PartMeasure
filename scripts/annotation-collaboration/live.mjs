// Real normal password Auth + app HTTP + isolated DB/private Storage. No browser/mocks.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const root = "http://127.0.0.1:3122";
if (
	process.env.PM_NETWORK_MODE !== "direct" ||
	new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !==
		"rvysclscetfqicpnzlra.supabase.co"
)
	throw Error("ISOLATED_ONLY");
const accounts = JSON.parse(
	await readFile("tmp/p0-1/test-accounts.json", "utf8"),
);
const fixture = { prefix: `COLLAB-${Date.now()}` },
	results = [];
function client() {
	const jar = new Map();
	let token;
	async function raw(path, options = {}) {
		const r = await fetch(root + path, {
			...options,
			headers: {
				cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
				...options.headers,
			},
			signal: options.signal ?? AbortSignal.timeout(60000),
		});
		for (const cookie of r.headers.getSetCookie()) {
			const p = cookie.split(";")[0],
				i = p.indexOf("=");
			jar.set(p.slice(0, i), p.slice(i + 1));
		}
		return r;
	}
	async function call(
		path,
		method = "GET",
		body,
		revision,
		key = randomUUID(),
	) {
		if (method !== "GET" && !token)
			token = (await (await raw("/api/csrf")).json()).data?.token;
		const r = await raw(path, {
			method,
			headers:
				method === "GET"
					? {}
					: {
							origin: root,
							"x-csrf-token": token,
							"Idempotency-Key": key,
							"Content-Type": "application/json",
							...(revision ? { "x-pm-revision": `"${revision}"` } : {}),
						},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		const json = await r.json();
		if (!r.ok)
			throw Object.assign(Error(), {
				code: json.error?.code,
				status: r.status,
			});
		return json.data;
	}
	return { call, raw };
}
const A = client(),
	B = client(),
	G = client(),
	anonymous = client();
let O, C, file, hash, link, line, issue, canonical;
const metadata = {
	name: "",
	dimension: "",
	unit: "mm",
	source: "human",
	circleMeasure: "diameter",
	holeDepth: "",
	holeType: "",
	thread: "",
	notes: "",
};
const geometry = {
	type: "line",
	from: { x: 0.1, y: 0.2 },
	to: { x: 0.7, y: 0.2 },
};
async function check(name, work) {
	const started = Date.now();
	try {
		await work();
		results.push({ name, status: "PASS", milliseconds: Date.now() - started });
	} catch (e) {
		results.push({
			name,
			status: "FAIL",
			code: /^[A-Z0-9_]+$/.test(e.code ?? "")
				? e.code
				: "ASSERTION_OR_DEPENDENCY_FAILED",
			...(e.status ? { httpStatus: e.status } : {}),
		});
	}
	console.log(JSON.stringify(results.at(-1)));
}
const reject = (promise, status) =>
	assert.rejects(promise, (e) => e.status === status);
async function create(extra = {}, shape = geometry) {
	return A.call(`${O}/annotations`, "POST", {
		id: randomUUID(),
		fileId: file,
		imageHash: hash,
		geometry: shape,
		metadata: { ...metadata, ...extra },
	});
}
const list = async (a) =>
	(await G.call(`${C}/files/${file}/issues?annotationId=${a.id}`)).items;
const patch = (a, extra = {}, shape = a.geometry) =>
	A.call(
		`${O}/annotations/${a.id}`,
		"PATCH",
		{ imageHash: hash, geometry: shape, metadata: { ...a.metadata, ...extra } },
		a.revision,
	);
const numeric = {
	kind: "numeric",
	value: "119.8",
	unit: "mm",
	body: "",
	evidenceFileIds: [],
	guestLabel: "",
};
const confirm = (responseId) => ({
	decision: "confirm",
	responseId,
	value: "119.8",
	unit: "mm",
	source: "customer_numeric",
	note: "",
});
try {
	await check(
		"normal-password-two-owners-Guest-session-and-real-private-photo",
		async () => {
			await A.call("/api/auth/login", "POST", accounts.A);
			await B.call("/api/auth/login", "POST", accounts.B);
			const project = await A.call("/api/projects", "POST", {
				name: fixture.prefix,
				description: "标注原位协作真实HTTP回归",
			});
			fixture.projectId = project.id;
			O = `/api/projects/${project.id}`;
			C = `/api/guest/projects/${project.id}`;
			link = await A.call(`${O}/share-links`, "POST", {});
			fixture.shareUrl = link.url;
			await G.call("/api/guest/session", "POST", {
				token: new URL(link.url).pathname.split("/").at(-1),
			});
			const bytes = await readFile(
				"experiments/konva/public/fixtures/640x480-o6-source.jpg",
			);
			const upload = await G.call(`${C}/uploads`, "POST", {
				filename: "协作验证.jpg",
				byteSize: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				declaredMime: "image/jpeg",
			});
			const grant = await G.call(`${C}/uploads/${upload.id}/grant`, "POST");
			const sent = await fetch(grant.signedUrl, {
				method: "PUT",
				headers: { "Content-Type": "image/jpeg" },
				body: bytes,
				signal: AbortSignal.timeout(60000),
			});
			assert.ok(sent.ok);
			await sent.body?.cancel();
			assert.equal(
				(await G.call(`${C}/uploads/${upload.id}/complete`, "POST", {})).state,
				"ready",
			);
			file = upload.id;
			fixture.fileId = file;
			const document = await G.call(`${C}/files/${file}/annotations`);
			hash = document.image.imageHash;
			canonical = document.image;
			const privateRead = await G.raw(`${C}/files/${file}/preview`);
			assert.equal(privateRead.status, 200);
			await privateRead.body?.cancel();
			assert.equal(
				(await anonymous.raw(`${C}/files/${file}/preview`)).status,
				401,
			);
		},
	);
	await check(
		"saving-line-opens-pending-without-publish-and-refresh-restores-it",
		async () => {
			line = await create({
				name: "总长度",
				measurementInstructions: "测量两端外侧距离",
			});
			fixture.annotationId = line.id;
			const items = await list(line);
			assert.equal(items.length, 1);
			issue = items[0];
			assert.equal(issue.state, "awaiting_response");
			const saved = (await A.call(`${O}/files/${file}/annotations`)).items.find(
				(a) => a.id === line.id,
			);
			assert.equal(saved.collaboration.pending, 1);
			line = await patch(line, { name: "总长度（完整）" });
			assert.equal((await list(line)).length, 1);
		},
	);
	await check("numeric-submit-review-writeback-and-fixed-history", async () => {
		const key = randomUUID();
		const [r, repeated] = await Promise.all([
			G.call(
				`${C}/issues/${issue.id}/responses`,
				"POST",
				numeric,
				issue.revision,
				key,
			),
			G.call(
				`${C}/issues/${issue.id}/responses`,
				"POST",
				numeric,
				issue.revision,
				key,
			),
		]);
		assert.equal(r.responseId, repeated.responseId);
		await reject(
			G.call(
				`${C}/issues/${issue.id}/responses`,
				"POST",
				numeric,
				issue.revision,
			),
			409,
		);
		const before = (await G.call(`${C}/files/${file}/annotations`)).items.find(
			(a) => a.id === line.id,
		);
		assert.equal(before.collaboration.submitted, 1);
		await A.call(
			`${O}/issues/${issue.id}/review`,
			"POST",
			confirm(r.responseId),
			r.revision,
		);
		const after = (await G.call(`${C}/files/${file}/annotations`)).items.find(
			(a) => a.id === line.id,
		);
		assert.equal(after.metadata.dimension, "119.8");
		assert.equal(
			after.collaboration.pending + after.collaboration.submitted,
			0,
		);
		const history = await G.call(`${C}/issues/${issue.id}`);
		assert.equal(history.responses.length, 1);
		assert.equal(history.reviews.length, 1);
		assert.equal(history.target.annotation.metadata.dimension, "");
	});
	await check(
		"photo-unable-remeasure-and-manual-confirmation-preserve-originals",
		async () => {
			const a = await create({ name: "孔径照片", measurementMethod: "inside" });
			const i = (await list(a))[0];
			const unable = await G.call(
				`${C}/issues/${i.id}/responses`,
				"POST",
				{
					kind: "unable",
					body: "暂时不会读卡尺",
					evidenceFileIds: [],
					guestLabel: "",
				},
				i.revision,
			);
			const redo = await A.call(
				`${O}/issues/${i.id}/review`,
				"POST",
				{
					decision: "remeasure",
					responseId: unable.responseId,
					value: null,
					unit: null,
					source: null,
					note: "拍清接触位置与显示屏即可",
				},
				unable.revision,
			);
			const photo = await G.call(
				`${C}/issues/${i.id}/responses`,
				"POST",
				{
					kind: "photo",
					body: "测量照片",
					evidenceFileIds: [file],
					guestLabel: "",
				},
				redo.revision,
			);
			await A.call(
				`${O}/issues/${i.id}/review`,
				"POST",
				{
					decision: "confirm",
					responseId: photo.responseId,
					value: "8",
					unit: "mm",
					source: "owner_from_photo",
					note: "工程师人工查看照片录入",
				},
				photo.revision,
			);
			const history = await G.call(`${C}/issues/${i.id}`);
			assert.equal(history.responses.length, 2);
			assert.equal(history.reviews.length, 2);
			assert.equal(history.responses[1].attachments.length, 1);
		},
	);
	await check(
		"direct-fill-and-description-only-remove-pending-closed-write-denied",
		async () => {
			let a = await create();
			const i = (await list(a))[0];
			a = await patch(a, { dimension: "120" });
			assert.ok((await list(a))[0].closedAt);
			await reject(
				G.call(`${C}/issues/${i.id}/responses`, "POST", numeric, i.revision),
				409,
			);
			const note = await create({ measurementMode: "none" });
			assert.equal((await list(note)).length, 0);
			const point = await create({}, { type: "point", at: { x: 0.2, y: 0.2 } });
			assert.equal((await list(point)).length, 0);
		},
	);
	await check(
		"diameter-depth-split-and-snapshot-replacement-rejects-old-review",
		async () => {
			const radius = 0.08;
			let a = await create(
				{ name: "孔", requireHoleDepth: true },
				{
					type: "circle",
					center: { x: 0.5, y: 0.5 },
					radiusX: radius,
					radiusY: (radius * canonical.width) / canonical.height,
				},
			);
			assert.deepEqual((await list(a)).map((i) => i.measurementField).sort(), [
				"dimension",
				"holeDepth",
			]);
			const old = (await list(a)).find(
				(i) => i.measurementField === "dimension",
			);
			const reply = await G.call(
				`${C}/issues/${old.id}/responses`,
				"POST",
				numeric,
				old.revision,
			);
			a = await patch(a, {}, { ...a.geometry, center: { x: 0.55, y: 0.5 } });
			assert.equal(
				(await list(a)).filter((i) => !i.closedAt && i.state !== "confirmed")
					.length,
				2,
			);
			await reject(
				A.call(
					`${O}/issues/${old.id}/review`,
					"POST",
					confirm(reply.responseId),
					reply.revision,
				),
				409,
			);
			assert.equal((await G.call(`${C}/issues/${old.id}`)).responses.length, 1);
		},
	);
	await check(
		"Owner-isolation-Guest-edit-review-forbidden-and-revoked-link-denied",
		async () => {
			await reject(B.call(`${O}/files/${file}/annotations`), 404);
			await reject(
				G.call(
					`${C}/annotations/${line.id}`,
					"DELETE",
					undefined,
					line.revision,
				),
				403,
			);
			await reject(
				G.call(
					`${C}/issues/${issue.id}/review`,
					"POST",
					confirm(randomUUID()),
					1,
				),
				403,
			);
			const counts = (await G.call(`${C}/issues`)).counts;
			assert.ok(counts.awaiting_response >= 2);
			await A.call(`${O}/share-links/${link.id}`, "DELETE");
			await reject(G.call(`${C}/files/${file}/annotations`), 401);
			assert.equal((await G.raw(`${C}/files/${file}/download`)).status, 401);
		},
	);
} finally {
	await mkdir("docs/evidence/annotation-collaboration", { recursive: true });
	await mkdir("tmp/annotation-collaboration", { recursive: true });
	await writeFile(
		"tmp/annotation-collaboration/fixture.json",
		`${JSON.stringify(fixture, null, 2)}\n`,
	);
	await writeFile(
		"docs/evidence/annotation-collaboration/live.json",
		`${JSON.stringify({ checkedAt: new Date().toISOString(), scope: "Local production Next HTTP with real isolated Supabase Auth/DB/private Storage; no browser/phone/network acceptance", results }, null, 2)}\n`,
	);
}
if (results.some((r) => r.status !== "PASS")) process.exitCode = 1;
