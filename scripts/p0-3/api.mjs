// Real normal Auth + app API + existing safely processed private assets. No admin login substitutes.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { context, call, requireData } from "../p0-2/helpers.mjs";
await mkdir("tmp/p0-3", { recursive: true });
await mkdir("docs/evidence/p0-3", { recursive: true });
const f = JSON.parse(await readFile("tmp/p0-2/fixture.json", "utf8")),
	results = [],
	contexts = [];
const oldFixture = JSON.parse(
	await readFile("tmp/p0-1/business-fixtures.json", "utf8"),
);
const a = await context("A"),
	b = await context("B"),
	g = await context();
contexts.push(a, b, g);
const O = `/api/projects/${f.projectA}`,
	G = `/api/guest/projects/${f.projectA}`;
async function check(name, work) {
	process.stdout.write(`start: ${name}\n`);
	try {
		await work();
		results.push({ check: name, status: "PASS" });
	} catch (e) {
		results.push({
			check: name,
			status: "FAIL",
			code: /^HTTP_\d+_[A-Z_]+$/.test(e.message) ? e.message : e.name,
		});
	}
	await writeFile("tmp/p0-3/api-progress.json", JSON.stringify(results));
	process.stdout.write(`${name}: ${results.at(-1).status}\n`);
}
const meta = {
	name: "P0-3 固定目标验证",
	dimension: "",
	unit: "mm",
	source: "human",
	circleMeasure: "diameter",
	holeDepth: "",
	holeType: "",
	thread: "",
	notes: "",
};
const response = (kind, extra = {}) => ({
	kind,
	body: "",
	guestLabel: "实验客户",
	evidenceFileIds: [],
	...extra,
});
const review = (responseId, extra = {}) => ({
	decision: "confirm",
	responseId,
	value: "12.345",
	unit: "mm",
	source: "customer_numeric",
	note: "",
	...extra,
});
let annotation, image, photo, unable, numeric, comment, race, negative;
async function measurement(title) {
	return requireData(
		await call(a, `${O}/issues`, "POST", {
			kind: "measurement",
			fileId: f.image,
			annotationRef: { id: annotation.id, revision: annotation.revision },
			title,
			targetInfo: "测量圈出的孔内径；数值或测量照片均可。",
			description: "保持卡尺与孔径方向一致；不能操作时说明原因。",
			measurementMethod: "inside",
		}),
		201,
	);
}
async function detail(id, actor = a, prefix = O) {
	return requireData(await call(actor, `${prefix}/issues/${id}`));
}
try {
	await requireData(
		await call(g, "/api/guest/session", "POST", {
			token: f.shareUrl.split("/").pop(),
		}),
	);
	image = (
		await requireData(await call(a, `${O}/files/${f.image}/annotations`))
	).image;
	annotation = await requireData(
		await call(a, `${O}/annotations`, "POST", {
			id: randomUUID(),
			fileId: f.image,
			imageHash: image.imageHash,
			geometry: {
				type: "circle",
				center: { x: 0.25, y: 0.35 },
				radiusX: 72 / 1600,
				radiusY: 72 / 1000,
			},
			metadata: meta,
		}),
		201,
	);
	await check(
		"normal-auth-projects-and-guest-private-file-prerequisites",
		async () => {
			assert.equal((await call(b, O)).status, 404);
			assert.equal(
				(await call(g, `${G}/files/${f.image}/preview`)).status,
				200,
			);
			assert.equal(image.normalizationVersion, 1);
		},
	);
	await check(
		"fixed-revision-snapshot-survives-later-annotation-edit",
		async () => {
			numeric = await measurement("接口验证 · 原数值确认");
			const before = await detail(numeric.id, g, G);
			annotation = await requireData(
				await call(
					a,
					`${O}/annotations/${annotation.id}`,
					"PATCH",
					{
						imageHash: image.imageHash,
						geometry: { ...annotation.geometry, center: { x: 0.35, y: 0.45 } },
						metadata: { ...meta, notes: "发出请求后移动标注" },
					},
					{ revision: 1 },
				),
			);
			const after = await detail(numeric.id, g, G);
			assert.equal(after.target.annotationRef.revision, 1);
			assert.deepEqual(after.target, before.target);
			assert.notDeepEqual(
				after.target.annotation.geometry,
				annotation.geometry,
			);
		},
	);
	await check(
		"numeric-response-atomic-evidence-idempotency-and-original-confirmation",
		async () => {
			const key = randomUUID(),
				input = response("numeric", {
					value: "12.345",
					unit: "mm",
					evidenceFileIds: [f.exif],
				});
			const submitted = await requireData(
				await call(g, `${G}/issues/${numeric.id}/responses`, "POST", input, {
					revision: 1,
					key,
				}),
				201,
			);
			assert.deepEqual(
				await requireData(
					await call(g, `${G}/issues/${numeric.id}/responses`, "POST", input, {
						revision: 1,
						key,
					}),
					201,
				),
				submitted,
			);
			assert.equal(
				(
					await call(g, `${G}/issues/${numeric.id}/responses`, "POST", input, {
						revision: 2,
					})
				).status,
				409,
			);
			const state = await detail(numeric.id);
			assert.equal(state.state, "submitted");
			assert.equal(state.responses.length, 1);
			assert.equal(state.responses[0].attachments[0].id, f.exif);
			assert.equal(
				(await call(a, `${O}/files/${f.exif}`, "DELETE")).status,
				409,
			);
			await requireData(
				await call(
					a,
					`${O}/issues/${numeric.id}/review`,
					"POST",
					review(submitted.responseId),
					{ revision: 2 },
				),
				201,
			);
			const done = await detail(numeric.id, g, G);
			assert.equal(done.state, "confirmed");
			assert.equal(done.responses[0].value, "12.345");
			assert.equal(done.reviews[0].source, "customer_numeric");
		},
	);
	await check(
		"photo-only-reply-and-manual-photo-confirmation-with-source-note",
		async () => {
			photo = await measurement("接口验证 · 仅照片回复");
			const reply = await requireData(
				await call(
					g,
					`${G}/issues/${photo.id}/responses`,
					"POST",
					response("photo", {
						evidenceFileIds: [f.exif],
						body: "仅提供测量照片，未填数值",
					}),
					{ revision: 1 },
				),
				201,
			);
			assert.equal(
				(
					await call(
						a,
						`${O}/issues/${photo.id}/review`,
						"POST",
						review(reply.responseId),
						{ revision: 2 },
					)
				).status,
				422,
			);
			assert.equal(
				(
					await call(
						a,
						`${O}/issues/${photo.id}/review`,
						"POST",
						review(reply.responseId, {
							source: "owner_from_photo",
							value: "12.4",
						}),
						{ revision: 2 },
					)
				).status,
				422,
			);
			await requireData(
				await call(
					a,
					`${O}/issues/${photo.id}/review`,
					"POST",
					review(reply.responseId, {
						source: "owner_from_photo",
						value: "12.4",
						note: "合成样本测试：工程师人工录入，不代表真实工程尺寸",
					}),
					{ revision: 2 },
				),
				201,
			);
			const done = await detail(photo.id, g, G);
			assert.equal(done.responses[0].value, null);
			assert.equal(done.responses[0].attachments.length, 1);
			assert.equal(done.reviews[0].value, "12.4");
			assert.equal(done.reviews[0].source, "owner_from_photo");
		},
	);
	await check(
		"unable-remeasure-resubmit-append-history-and-manual-correction",
		async () => {
			unable = await measurement("接口验证 · 无法测量与重测");
			const first = await requireData(
				await call(
					g,
					`${G}/issues/${unable.id}/responses`,
					"POST",
					response("unable", { body: "卡尺无法伸入，需要补充零件视角" }),
					{ revision: 1 },
				),
				201,
			);
			await requireData(
				await call(
					a,
					`${O}/issues/${unable.id}/review`,
					"POST",
					review(first.responseId, {
						decision: "remeasure",
						value: null,
						unit: null,
						source: null,
						note: "换一个角度后重测，或上传照片",
					}),
					{ revision: 2 },
				),
				201,
			);
			assert.equal(
				(await detail(unable.id, g, G)).state,
				"remeasure_requested",
			);
			const second = await requireData(
				await call(
					g,
					`${G}/issues/${unable.id}/responses`,
					"POST",
					response("numeric", {
						value: "8.2",
						unit: "mm",
						evidenceFileIds: [f.exif],
					}),
					{ revision: 3 },
				),
				201,
			);
			assert.equal(
				(
					await call(
						a,
						`${O}/issues/${unable.id}/review`,
						"POST",
						review(second.responseId, { value: "8.25" }),
						{ revision: 4 },
					)
				).status,
				422,
			);
			await requireData(
				await call(
					a,
					`${O}/issues/${unable.id}/review`,
					"POST",
					review(second.responseId, {
						source: "owner_manual",
						value: "8.25",
						note: "人工核对补充证据后修正；保留客户原始8.2",
					}),
					{ revision: 4 },
				),
				201,
			);
			const done = await detail(unable.id, g, G);
			assert.equal(done.state, "confirmed");
			assert.equal(done.responses.length, 2);
			assert.equal(done.reviews.length, 2);
			assert.equal(done.responses[0].kind, "unable");
			assert.equal(done.responses[1].value, "8.2");
			assert.equal(done.reviews[1].value, "8.25");
		},
	);
	await check(
		"legacy-file-comment-text-reply-and-processing-without-number-or-geometry",
		async () => {
			comment = await requireData(
				await call(a, `${O}/issues`, "POST", {
					fileId: f.attachment,
					title: "接口验证 · 文件文字回复",
					description: "请说明附件包含的零件",
				}),
				201,
			);
			const replied = await requireData(
				await call(
					g,
					`${G}/issues/${comment.id}/responses`,
					"POST",
					response("text", {
						body: "附件包含安装板和连接销",
						evidenceFileIds: [f.attachment],
					}),
					{ revision: 1 },
				),
				201,
			);
			await requireData(
				await call(
					a,
					`${O}/issues/${comment.id}/review`,
					"POST",
					review(replied.responseId, {
						value: null,
						unit: null,
						source: "comment",
						note: "说明已核对",
					}),
					{ revision: 2 },
				),
				201,
			);
			const done = await detail(comment.id, g, G);
			assert.equal(done.target, null);
			assert.equal(done.state, "confirmed");
			assert.equal(done.responses[0].kind, "text");
			assert.equal(done.reviews[0].value, null);
		},
	);
	await check(
		"guest-review-and-management-denied-owner-isolation",
		async () => {
			assert.equal(
				(
					await call(
						g,
						`${G}/issues/${numeric.id}/review`,
						"POST",
						review(randomUUID()),
						{ revision: 1 },
					)
				).status,
				403,
			);
			assert.equal(
				(
					await call(
						g,
						`${G}/issues/${numeric.id}`,
						"PATCH",
						{ state: "confirmed" },
						{ revision: 1 },
					)
				).status,
				403,
			);
			assert.equal((await call(b, `${O}/issues/${numeric.id}`)).status, 404);
			assert.equal(
				(
					await call(
						b,
						`${O}/issues/${numeric.id}/responses`,
						"POST",
						response("unable", { body: "伪造越权" }),
						{ revision: 1 },
					)
				).status,
				404,
			);
			assert.equal(
				(
					await call(
						g,
						`/api/guest/projects/${f.projectB}/issues/${numeric.id}`,
					)
				).status,
				401,
			);
		},
	);
	await check(
		"invalid-numeric-control-fields-and-not-ready-evidence-roll-back",
		async () => {
			negative = await measurement("接口验证 · 非法输入拒绝");
			for (const input of [
				response("numeric", { value: "-1", unit: "mm" }),
				response("numeric", { value: "1e3", unit: "mm" }),
				response("numeric", { value: "2", unit: "deg" }),
				response("numeric", { value: "2", unit: "mm", state: "confirmed" }),
				response("unable", { body: " " }),
			])
				assert.equal(
					(
						await call(
							g,
							`${G}/issues/${negative.id}/responses`,
							"POST",
							input,
							{ revision: 1 },
						)
					).status,
					422,
				);
			const pending = await requireData(
				await call(g, `${G}/uploads`, "POST", {
					filename: "p03-pending-evidence.png",
					byteSize: 64,
					declaredMime: "image/png",
					sha256: randomBytes(32).toString("hex"),
				}),
				201,
			);
			f.pendingReservation = pending.id;
			for (const ids of [
				[pending.id],
				[randomUUID()],
				[f.attachment],
				[oldFixture.ownerFile],
			])
				assert.equal(
					(
						await call(
							g,
							`${G}/issues/${negative.id}/responses`,
							"POST",
							response("photo", { evidenceFileIds: ids }),
							{ revision: 1 },
						)
					).status,
					422,
				);
			const unchanged = await detail(negative.id);
			assert.equal(unchanged.state, "awaiting_response");
			assert.equal(unchanged.revision, 1);
			assert.equal(unchanged.responses.length, 0);
		},
	);
	await check(
		"real-concurrent-responses-and-reviews-cas-one-winner",
		async () => {
			race = await measurement("接口验证 · 并发冲突");
			const g2 = await context();
			contexts.push(g2);
			await requireData(
				await call(g2, "/api/guest/session", "POST", {
					token: f.shareUrl.split("/").pop(),
				}),
			);
			const replies = await Promise.all(
				[g, g2].map((c) =>
					call(
						c,
						`${G}/issues/${race.id}/responses`,
						"POST",
						response("numeric", { value: "8", unit: "mm" }),
						{ revision: 1 },
					),
				),
			);
			assert.deepEqual(replies.map((r) => r.status).sort(), [201, 409]);
			const winner = replies.find((r) => r.status === 201).data;
			const reviews = await Promise.all([
				call(
					a,
					`${O}/issues/${race.id}/review`,
					"POST",
					review(winner.responseId, { value: "8" }),
					{ revision: 2 },
				),
				call(
					a,
					`${O}/issues/${race.id}/review`,
					"POST",
					review(winner.responseId, {
						decision: "remeasure",
						value: null,
						unit: null,
						source: null,
						note: "并发退回测试",
					}),
					{ revision: 2 },
				),
			]);
			assert.deepEqual(reviews.map((r) => r.status).sort(), [201, 409]);
			const done = await detail(race.id);
			assert.equal(done.responses.length, 1);
			assert.equal(done.reviews.length, 1);
			assert.equal(done.revision, 3);
		},
	);
	await check(
		"new-normal-session-restores-history-and-priority-summary",
		async () => {
			const fresh = await context("A");
			contexts.push(fresh);
			const done = await detail(unable.id, fresh);
			assert.equal(done.responses.length, 2);
			assert.equal(done.reviews[1].source, "owner_manual");
			const list = await requireData(await call(g, `${G}/issues`));
			assert.ok(list.counts.confirmed >= 4);
			assert.ok(
				["awaiting_response", "remeasure_requested"].includes(
					list.items[0].state,
				),
			);
		},
	);
	f.p03 = {
		annotation: annotation.id,
		annotationRevision: annotation.revision,
		numeric: numeric?.id,
		photo: photo?.id,
		unable: unable?.id,
		comment: comment?.id,
		negative: negative?.id,
		race: race?.id,
	};
	await writeFile("tmp/p0-3/fixture.json", JSON.stringify(f));
} catch (e) {
	results.push({
		check: "suite-prerequisite",
		status: "FAIL",
		code: /^HTTP_\d+_[A-Z_]+$/.test(e.message) ? e.message : e.name,
	});
} finally {
	await Promise.all(contexts.map((c) => c.dispose()));
}
await writeFile(
	"docs/evidence/p0-3/api.json",
	`${JSON.stringify({ checkedAt: new Date().toISOString(), projectRef: "rvysclscetfqicpnzlra", realService: true, reusesP02ProjectAndProcessedFiles: true, results }, null, 2)}\n`,
);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
