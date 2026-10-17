import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { context, call, requireData } from "../p0-2/helpers.mjs";
const f = JSON.parse(await readFile("tmp/p0-3/fixture.json", "utf8")),
	a = await context("A"),
	g = await context(),
	g2 = await context(),
	results = [];
const O = `/api/projects/${f.projectA}`,
	G = `/api/guest/projects/${f.projectA}`;
let replies = [],
	reviews = [];
try {
	for (const c of [g, g2])
		await requireData(
			await call(c, "/api/guest/session", "POST", {
				token: f.shareUrl.split("/").pop(),
			}),
		);
	const i = await requireData(
		await call(a, `${O}/issues`, "POST", {
			kind: "measurement",
			fileId: f.image,
			annotationRef: {
				id: f.p03.annotation,
				revision: f.p03.annotationRevision,
			},
			title: "并发定向验证",
			targetInfo: "固定孔位并发回复验证",
			description: "隔离服务测试",
			measurementMethod: "inside",
		}),
		201,
	);
	const input = {
		kind: "numeric",
		value: "8",
		unit: "mm",
		body: "",
		evidenceFileIds: [],
		guestLabel: "",
	};
	replies = await Promise.all(
		[g, g2].map((c) =>
			call(c, `${G}/issues/${i.id}/responses`, "POST", input, { revision: 1 }),
		),
	);
	results.push({
		check: "two-real-concurrent-responses",
		status:
			JSON.stringify(replies.map((r) => r.status).sort()) === "[201,409]"
				? "PASS"
				: "FAIL",
		http: replies.map((r) => ({ status: r.status, code: r.code })),
	});
	const winner = replies.find((r) => r.status === 201)?.data;
	assert.ok(winner);
	reviews = await Promise.all(
		[
			{
				decision: "confirm",
				responseId: winner.responseId,
				value: "8",
				unit: "mm",
				source: "customer_numeric",
				note: "",
			},
			{
				decision: "remeasure",
				responseId: winner.responseId,
				value: null,
				unit: null,
				source: null,
				note: "并发退回测试",
			},
		].map((input) =>
			call(a, `${O}/issues/${i.id}/review`, "POST", input, { revision: 2 }),
		),
	);
	results.push({
		check: "two-real-concurrent-reviews",
		status:
			JSON.stringify(reviews.map((r) => r.status).sort()) === "[201,409]"
				? "PASS"
				: "FAIL",
		http: reviews.map((r) => ({ status: r.status, code: r.code })),
	});
	const d = await requireData(await call(a, `${O}/issues/${i.id}`));
	assert.equal(d.responses.length, 1);
	assert.equal(d.reviews.length, 1);
	assert.equal(d.revision, 3);
	results.push({
		check: "single-history-record-per-transition",
		status: "PASS",
	});
} catch (e) {
	results.push({
		check: "concurrency-completion",
		status: "FAIL",
		code: /^HTTP_\d+_[A-Z_]+$/.test(e.message) ? e.message : e.name,
	});
} finally {
	await a.dispose();
	await g.dispose();
	await g2.dispose();
}
await writeFile(
	"docs/evidence/p0-3/concurrency.json",
	`${JSON.stringify({ checkedAt: new Date().toISOString(), realService: true, results }, null, 2)}\n`,
);
for (const r of results) process.stdout.write(`${r.check}: ${r.status}\n`);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
