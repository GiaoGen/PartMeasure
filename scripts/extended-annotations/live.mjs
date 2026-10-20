// Real normal password Auth + app HTTP + isolated DB/private Storage. No browser/mocks.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const root = "http://127.0.0.1:3123";
if (
	process.env.PM_NETWORK_MODE !== "direct" ||
	new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !==
		"rvysclscetfqicpnzlra.supabase.co"
)
	throw Error("ISOLATED_ONLY");
const accounts = JSON.parse(
	await readFile("tmp/p0-1/test-accounts.json", "utf8"),
);
const fixture = { prefix: `EXTTOOLS-${Date.now()}` },
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
let O, C, file, hash, link, line, issue, _canonical;
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
				description: "扩展标注工具真实HTTP回归",
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
			_canonical = document.image;
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
		"ellipse-diameter-default-persist-reply-confirm-and-optional-semiaxis",
		async () => {
			const shape = {
				type: "ellipse",
				center: { x: 0.5, y: 0.5 },
				axisA: { x: 0.7, y: 0.5 },
				axisB: { x: 0.5, y: 0.625 },
			};
			let a = await create({ name: "圆孔（斜拍）" }, shape);
			fixture.annotationId = a.id;
			let i = (await list(a))[0];
			assert.equal(i.measurementField, "dimension");
			let r = await G.call(
				`${C}/issues/${i.id}/responses`,
				"POST",
				{ ...numeric, value: "20" },
				i.revision,
			);
			await A.call(
				`${O}/issues/${i.id}/review`,
				"POST",
				{ ...confirm(r.responseId), value: "20" },
				r.revision,
			);
			a = (await G.call(`${C}/files/${file}/annotations`)).items.find(
				(x) => x.id === a.id,
			);
			assert.equal(a.metadata.dimension, "20");
			assert.equal(a.schemaVersion, 2);
			a = await patch(a, { ellipseMeasure: "majorRadius" });
			i = (await list(a)).find(
				(x) => x.measurementField === "majorRadius" && !x.closedAt,
			);
			r = await G.call(
				`${C}/issues/${i.id}/responses`,
				"POST",
				{ ...numeric, value: "1", unit: "cm" },
				i.revision,
			);
			await A.call(
				`${O}/issues/${i.id}/review`,
				"POST",
				{ ...confirm(r.responseId), value: "1", unit: "cm" },
				r.revision,
			);
			a = (await G.call(`${C}/files/${file}/annotations`)).items.find(
				(x) => x.id === a.id,
			);
			assert.equal(a.metadata.majorRadius, "1");
			assert.equal(a.metadata.dimension, "2");
			assert.ok(
				(await A.call(`${O}/annotations/${a.id}/revisions`)).items.length >= 4,
			);
		},
	);
	await check(
		"angle-degrees-display-only-adjustment-fixed-snapshot-and-conflict",
		async () => {
			const shape = {
				type: "angle",
				vertex: { x: 0.4, y: 0.5 },
				from: { x: 0.7, y: 0.5 },
				to: { x: 0.4, y: 0.2 },
				reflex: false,
			};
			let a = await create({ name: "夹角" }, shape),
				i = (await list(a))[0];
			assert.equal(i.measurementField, "angleValue");
			a = await patch(a, {}, { ...shape, arcScale: 0.7 });
			assert.equal((await list(a))[0].id, i.id);
			await reject(
				G.call(
					`${C}/issues/${i.id}/responses`,
					"POST",
					{ ...numeric, value: "45", unit: "mm" },
					i.revision,
				),
				422,
			);
			const r = await G.call(
				`${C}/issues/${i.id}/responses`,
				"POST",
				{ ...numeric, value: "45", unit: "deg" },
				i.revision,
			);
			await A.call(
				`${O}/issues/${i.id}/review`,
				"POST",
				{ ...confirm(r.responseId), value: "45", unit: "deg" },
				r.revision,
			);
			const saved = (await G.call(`${C}/files/${file}/annotations`)).items.find(
				(x) => x.id === a.id,
			);
			assert.equal(saved.metadata.angleValue, "45");
			assert.equal(saved.metadata.unit, "mm");
			const history = await G.call(`${C}/issues/${i.id}`);
			assert.equal(history.target.annotation.metadata.angleValue, undefined);
			await reject(patch(a, { name: "stale" }), 409);
		},
	);
	await check(
		"arc-separate-radius-length-angle-and-old-line-compatibility",
		async () => {
			const a = await create(
				{ name: "圆弧", arcQuantities: ["radius", "arcLength", "angle"] },
				{
					type: "arc",
					from: { x: 0.3, y: 0.6 },
					via: { x: 0.5, y: 0.35 },
					to: { x: 0.7, y: 0.6 },
				},
			);
			const items = await list(a);
			assert.equal(items.length, 3);
			for (const [field, value, unit] of [
				["dimension", "20", "mm"],
				["arcLength", "55", "mm"],
				["angleValue", "180", "deg"],
			]) {
				const i = items.find((x) => x.measurementField === field);
				const r = await G.call(
					`${C}/issues/${i.id}/responses`,
					"POST",
					{ ...numeric, value, unit },
					i.revision,
				);
				await A.call(
					`${O}/issues/${i.id}/review`,
					"POST",
					{ ...confirm(r.responseId), value, unit },
					r.revision,
				);
			}
			const saved = (await G.call(`${C}/files/${file}/annotations`)).items.find(
				(x) => x.id === a.id,
			);
			assert.equal(saved.metadata.angleValue, "180");
			assert.equal(saved.metadata.arcLength, "55");
			assert.equal(saved.metadata.dimension, "20");
			line = await create({ dimension: "100" });
			assert.equal(line.schemaVersion, 1);
			issue = items[0];
		},
	);
	await check(
		"Owner-isolation-Guest-mutation-review-denied-and-revocation",
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
			await A.call(`${O}/share-links/${link.id}`, "DELETE");
			await reject(G.call(`${C}/files/${file}/annotations`), 401);
		},
	);
} finally {
	await mkdir("docs/evidence/extended-annotations", { recursive: true });
	await mkdir("tmp/extended-annotations", { recursive: true });
	await writeFile(
		"tmp/extended-annotations/fixture.json",
		`${JSON.stringify(fixture, null, 2)}\n`,
	);
	await writeFile(
		"docs/evidence/extended-annotations/live.json",
		`${JSON.stringify({ checkedAt: new Date().toISOString(), scope: "Local production Next HTTP with real isolated Supabase Auth/DB/private Storage; no browser/phone/network acceptance", results }, null, 2)}\n`,
	);
}
if (results.some((r) => r.status !== "PASS")) process.exitCode = 1;
