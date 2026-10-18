// Cross-module regression complements the UI closed loop; uses normal sessions only.
import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
	context,
	root,
	call,
	requireData,
	saveReport,
	safeCode,
} from "./helpers.mjs";
const f = JSON.parse(await readFile("tmp/p0-4/fixture.json", "utf8")),
	results = [],
	a = await context("A"),
	g = await context(),
	O = `/api/projects/${f.projectA}`,
	G = `/api/guest/projects/${f.projectA}`;
const reply = (kind, extra = {}) => ({
	kind,
	body: "",
	guestLabel: "合成流程验证",
	evidenceFileIds: [],
	...extra,
});
const review = (responseId, extra = {}) => ({
	decision: "confirm",
	responseId,
	value: "20.1",
	unit: "mm",
	source: "owner_manual",
	note: "合成测试：人工复核修正，保留客户原回复",
	...extra,
});
async function check(name, work) {
	console.log(`start: ${name}`);
	try {
		await work();
		results.push({ check: name, status: "PASS" });
	} catch (e) {
		results.push({ check: name, status: "FAIL", code: safeCode(e) });
	}
	await saveReport("workflow-progress", results);
	console.log(`${name}: ${results.at(-1).status}`);
	if (results.at(-1).status === "FAIL") throw Error("PREREQUISITE");
}
try {
	requireData(
		await call(g, "/api/guest/session", "POST", {
			token: f.shareUrl.split("/").pop(),
		}),
	);
	let target;
	await check(
		"engineer-first-material-upload-normalized-and-fixed-request",
		async () => {
			const bytes = await readFile("tmp/p0-4/manual-sample.png");
			const reserved = requireData(
				await call(a, `${O}/uploads`, "POST", {
					filename: "owner-first-p04.png",
					byteSize: bytes.length,
					sha256: createHash("sha256").update(bytes).digest("hex"),
					declaredMime: "image/png",
				}),
				201,
			);
			const grant = requireData(
				await call(a, `${O}/uploads/${reserved.id}/grant`, "POST", {}),
			);
			assert.ok(
				(
					await fetch(grant.signedUrl, {
						method: "PUT",
						headers: { "Content-Type": "image/png" },
						body: bytes,
						signal: AbortSignal.timeout(90000),
					})
				).ok,
			);
			requireData(
				await call(a, `${O}/uploads/${reserved.id}/complete`, "POST", {}),
				202,
			);
			let ready = false;
			for (let n = 0; n < 80; n++) {
				const r = requireData(await call(a, `${O}/uploads/${reserved.id}`));
				if (r.state === "ready") {
					ready = true;
					break;
				}
				await new Promise((r) => setTimeout(r, 2000));
			}
			assert.equal(ready, true);
			const image = requireData(
				await call(a, `${O}/files/${reserved.id}/annotations`),
			).image;
			const annotation = requireData(
				await call(a, `${O}/annotations`, "POST", {
					id: randomUUID(),
					fileId: reserved.id,
					imageHash: image.imageHash,
					geometry: { type: "point", at: { x: 0.31, y: 0.45 } },
					metadata: {
						name: "Owner先传目标",
						dimension: "",
						unit: "mm",
						source: "human",
						circleMeasure: "diameter",
						holeDepth: "",
						holeType: "",
						thread: "",
						notes: "",
					},
				}),
				201,
			);
			target = {
				kind: "measurement",
				fileId: reserved.id,
				annotationRef: { id: annotation.id, revision: 1 },
				targetInfo: "圈示孔位，人工测量",
				description: "可以仅提供照片，不根据像素计算尺寸",
				measurementMethod: "inside",
			};
		},
	);
	await check(
		"photo-only-human-value-source-survives-delivery-module",
		async () => {
			const issue = requireData(
				await call(a, `${O}/issues`, "POST", {
					...target,
					title: "P04 仅照片与人工来源",
				}),
				201,
			);
			const r = requireData(
				await call(
					g,
					`${G}/issues/${issue.id}/responses`,
					"POST",
					reply("photo", {
						body: "只提供测量照片，无数值",
						evidenceFileIds: [f.material.id],
					}),
					{ revision: 1 },
				),
				201,
			);
			requireData(
				await call(
					a,
					`${O}/issues/${issue.id}/review`,
					"POST",
					review(r.responseId, { source: "owner_from_photo" }),
					{ revision: 2 },
				),
				201,
			);
			const d = requireData(await call(g, `${G}/issues/${issue.id}`));
			assert.equal(d.responses[0].value, null);
			assert.equal(d.responses[0].attachments.length, 1);
			assert.equal(d.reviews[0].source, "owner_from_photo");
			assert.equal(d.state, "confirmed");
		},
	);
	await check(
		"unable-remeasure-numeric-resubmit-and-append-history",
		async () => {
			const issue = requireData(
				await call(a, `${O}/issues`, "POST", {
					...target,
					title: "P04 无法测量后重测",
				}),
				201,
			);
			const first = requireData(
				await call(
					g,
					`${G}/issues/${issue.id}/responses`,
					"POST",
					reply("unable", { body: "卡尺无法伸入孔内" }),
					{ revision: 1 },
				),
				201,
			);
			requireData(
				await call(
					a,
					`${O}/issues/${issue.id}/review`,
					"POST",
					review(first.responseId, {
						decision: "remeasure",
						value: null,
						unit: null,
						source: null,
						note: "改变测量角度后重试",
					}),
					{ revision: 2 },
				),
				201,
			);
			assert.equal(
				requireData(await call(g, `${G}/issues/${issue.id}`)).state,
				"remeasure_requested",
			);
			const second = requireData(
				await call(
					g,
					`${G}/issues/${issue.id}/responses`,
					"POST",
					reply("numeric", { value: "20", unit: "mm" }),
					{ revision: 3 },
				),
				201,
			);
			requireData(
				await call(
					a,
					`${O}/issues/${issue.id}/review`,
					"POST",
					review(second.responseId),
					{ revision: 4 },
				),
				201,
			);
			const d = requireData(await call(g, `${G}/issues/${issue.id}`));
			assert.equal(d.responses.length, 2);
			assert.equal(d.reviews.length, 2);
			assert.ok(
				d.responses.some(
					(x) => x.id === first.responseId && x.kind === "unable",
				),
			);
			assert.equal(d.state, "confirmed");
		},
	);
} catch {
} finally {
	await a.dispose();
	await g.dispose();
}
await saveReport("workflow", results, {
	https: root.startsWith("https:"),
	mailRegistration: false,
});
if (results.some((x) => x.status === "FAIL")) process.exitCode = 1;
