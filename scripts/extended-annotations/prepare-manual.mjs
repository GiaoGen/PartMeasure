// Normal application login only. Secrets/links go exclusively to ignored local files.
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const root = "http://127.0.0.1:3123";
if (
	process.env.PM_NETWORK_MODE !== "direct" ||
	new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !==
		"rvysclscetfqicpnzlra.supabase.co"
)
	throw Error("ISOLATED_ONLY");
const fixture = JSON.parse(
	await readFile("tmp/extended-annotations/fixture.json", "utf8"),
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

const A = client();
let report;
try {
	await A.call("/api/auth/login", "POST", account);
	const O = `/api/projects/${fixture.projectId}`;
	const share = await A.call(`${O}/share-links`, "POST", {});
	const image = (await A.call(`${O}/files/${fixture.fileId}/annotations`))
		.image;
	await A.call(`${O}/annotations`, "POST", {
		id: randomUUID(),
		fileId: fixture.fileId,
		imageHash: image.imageHash,
		geometry: {
			type: "ellipse",
			center: { x: 0.5, y: 0.83 },
			axisA: { x: 0.7, y: 0.83 },
			axisB: { x: 0.5, y: 0.91 },
		},
		metadata: {
			name: "可试用：斜拍圆孔",
			dimension: "",
			unit: "mm",
			source: "human",
			circleMeasure: "diameter",
			holeDepth: "",
			holeType: "",
			thread: "",
			notes: "此轮廓只作定位，实际孔径由人填写",
			measurementInstructions: "填写孔径，也可仅传照片或说明无法测量",
		},
	});
	fixture.shareUrl = share.url;
	await writeFile(
		"tmp/extended-annotations/fixture.json",
		`${JSON.stringify(fixture, null, 2)}\n`,
	);
	await writeFile(
		"tmp/extended-annotations/manual-entry.txt",
		`工程师（正常登录）：${root}/projects/${fixture.projectId}\n客户：${share.url}\n凭据：tmp/p0-1/test-passwords.txt\n清单：docs/extended-annotations.md\n这是独立测试项目；包含新图形已确认数据及一个待补孔径。\n`,
	);
	report = {
		checkedAt: new Date().toISOString(),
		status: "PASS",
		scope:
			"Normal login, existing EXTTOOLS fixture, new valid private share and pending ellipse prepared. No browser or phone validation.",
	};
} catch (e) {
	report = {
		checkedAt: new Date().toISOString(),
		status: "FAIL",
		code: /^[A-Z0-9_]+$/.test(e.code ?? "")
			? e.code
			: "MANUAL_PREPARATION_FAILED",
	};
	process.exitCode = 1;
}
await writeFile(
	"docs/evidence/extended-annotations/manual-preparation.json",
	`${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report));
