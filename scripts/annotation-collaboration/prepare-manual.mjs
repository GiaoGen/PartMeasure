// Normal application login only. Secrets/links go exclusively to ignored local files.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const root = "http://127.0.0.1:3122";
if (
	process.env.PM_NETWORK_MODE !== "direct" ||
	new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !==
		"rvysclscetfqicpnzlra.supabase.co"
)
	throw Error("ISOLATED_ONLY");
const fixture = JSON.parse(
	await readFile("tmp/annotation-collaboration/fixture.json", "utf8"),
);
const account = JSON.parse(
	await readFile("tmp/p0-1/test-accounts.json", "utf8"),
).A;
function client() {
	const jar = new Map();
	let csrf;
	async function raw(path, options = {}) {
		const response = await fetch(root + path, {
			...options,
			headers: {
				cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
				...options.headers,
			},
			signal: options.signal ?? AbortSignal.timeout(60000),
		});
		for (const cookie of response.headers.getSetCookie()) {
			const part = cookie.split(";")[0],
				index = part.indexOf("=");
			jar.set(part.slice(0, index), part.slice(index + 1));
		}
		return response;
	}
	async function call(path, method = "GET", body, revision) {
		if (method !== "GET" && !csrf)
			csrf = (await (await raw("/api/csrf")).json()).data.token;
		const response = await raw(path, {
			method,
			headers:
				method === "GET"
					? {}
					: {
							origin: root,
							"x-csrf-token": csrf,
							"Idempotency-Key": randomUUID(),
							"Content-Type": "application/json",
							...(revision ? { "x-pm-revision": `"${revision}"` } : {}),
						},
			...(body ? { body: JSON.stringify(body) } : {}),
		});
		const json = await response.json();
		if (!response.ok) throw Object.assign(Error(), { code: json.error?.code });
		return json.data;
	}
	return { raw, call };
}
const A = client(),
	G = client(),
	stop = new AbortController();
let report;
try {
	await A.call("/api/auth/login", "POST", account);
	const O = `/api/projects/${fixture.projectId}`;
	const share = await A.call(`${O}/share-links`, "POST", {});
	await G.call("/api/guest/session", "POST", {
		token: new URL(share.url).pathname.split("/").at(-1),
	});
	const image = (await A.call(`${O}/files/${fixture.fileId}/annotations`))
		.image;
	const cursor = (await A.call(O)).syncCursor;
	const started = Date.now();
	const stream = await A.raw(
		`${O}/events?cursor=${encodeURIComponent(cursor)}`,
		{ signal: AbortSignal.any([stop.signal, AbortSignal.timeout(60000)]) },
	);
	assert.equal(stream.status, 200);
	const id = randomUUID();
	const event = (async () => {
		let buffer = "";
		const decoder = new TextDecoder();
		for await (const part of stream.body) {
			buffer += decoder.decode(part, { stream: true });
			while (buffer.includes("\n\n")) {
				const end = buffer.indexOf("\n\n"),
					chunk = buffer.slice(0, end);
				buffer = buffer.slice(end + 2);
				const data = chunk
					.split("\n")
					.find((line) => line.startsWith("data: "))
					?.slice(6);
				if (
					data &&
					JSON.parse(data).events?.some(
						(e) => e.kind === "annotation.changed" && e.entityId === id,
					)
				)
					return;
			}
		}
		throw Error("STREAM_ENDED");
	})();
	// Attach an immediate rejection handler; the awaited promise still reports failure below.
	void event.catch(() => {});
	await A.call(`${O}/annotations`, "POST", {
		id,
		fileId: fixture.fileId,
		imageHash: image.imageHash,
		geometry: {
			type: "line",
			from: { x: 0.1, y: 0.8 },
			to: { x: 0.7, y: 0.8 },
		},
		metadata: {
			name: "可试用：总长度",
			dimension: "",
			unit: "mm",
			source: "human",
			circleMeasure: "diameter",
			holeDepth: "",
			holeType: "",
			thread: "",
			notes: "",
			measurementInstructions: "测量两端外侧距离，也可上传照片",
		},
	});
	await event;
	fixture.shareUrl = share.url;
	await writeFile(
		"tmp/annotation-collaboration/fixture.json",
		`${JSON.stringify(fixture, null, 2)}\n`,
	);
	await writeFile(
		"tmp/annotation-collaboration/manual-entry.txt",
		`工程师（正常登录）：${root}/projects/${fixture.projectId}\n客户（无需注册）：${share.url}\n正常登录凭据：tmp/p0-1/test-passwords.txt\n检查清单：docs/annotation-collaboration.md\n测试资料已准备，勿用真实项目资料测试删除。\n`,
	);
	report = {
		checkedAt: new Date().toISOString(),
		status: "PASS",
		scope:
			"real app HTTP SSE delivered committed annotation change; manual inputs prepared, browser delivery/visual experience unverified",
		groupedMilliseconds: Date.now() - started,
	};
} catch (e) {
	report = {
		checkedAt: new Date().toISOString(),
		status: "FAIL",
		code: /^[A-Z0-9_]+$/.test(e.code ?? "")
			? e.code
			: "MANUAL_PREPARATION_OR_SSE_FAILED",
	};
	process.exitCode = 1;
} finally {
	stop.abort();
	await writeFile(
		"docs/evidence/annotation-collaboration/sse-and-manual.json",
		`${JSON.stringify(report, null, 2)}\n`,
	);
	console.log(JSON.stringify(report));
}
