import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { context, call, requireData } from "./helpers.mjs";
const fixture = JSON.parse(await readFile("tmp/p0-2/fixture.json", "utf8")),
	results = [],
	contexts = [];
const a = await context("A"),
	b = await context("B"),
	g = await context();
contexts.push(a, b, g);
const O = `/api/projects/${fixture.projectA}`,
	G = `/api/guest/projects/${fixture.projectA}`;
const meta = (name) => ({
	name,
	dimension: "",
	unit: "mm",
	source: "human",
	circleMeasure: "diameter",
	holeDepth: "",
	holeType: "",
	thread: "",
	notes: "",
});
async function check(name, work) {
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
	process.stdout.write(`${name}: ${results.at(-1).status}\n`);
}
let doc, line, circle, point, text, lineInput;
try {
	await requireData(
		await call(g, "/api/guest/session", "POST", {
			token: fixture.shareUrl.split("/").pop(),
		}),
	);
	await check("canonical-image-binding-and-owner-guest-read", async () => {
		doc = await requireData(
			await call(a, `${O}/files/${fixture.image}/annotations`),
		);
		assert.equal(doc.image.width, 1600);
		assert.equal(doc.image.height, 1000);
		assert.equal(doc.image.normalizationVersion, 1);
		assert.deepEqual(
			(
				await requireData(
					await call(g, `${G}/files/${fixture.image}/annotations`),
				)
			).image,
			doc.image,
		);
	});
	const geometries = [
		{ type: "line", from: { x: 0.25, y: 0.65 }, to: { x: 0.75, y: 0.65 } },
		{
			type: "circle",
			center: { x: 0.25, y: 0.35 },
			radiusX: 72 / 1600,
			radiusY: 72 / 1000,
		},
		{ type: "point", at: { x: 0.5, y: 0.5 } },
		{ type: "text", at: { x: 0.15, y: 0.15 }, text: "试样：人工标注" },
	];
	await check("create-four-types-human-fields-and-idempotency", async () => {
		const created = [];
		for (const [index, name] of [
			"长度 L1",
			"孔 A",
			"基准点",
			"文字备注",
		].entries()) {
			const metadata = meta(name);
			if (index === 0) metadata.dimension = "12.5";
			if (index === 1)
				Object.assign(metadata, {
					dimension: "6",
					holeDepth: "8",
					holeType: "threaded",
					thread: "M6 × 1",
					notes: "人工填写，仅用于试用。",
				});
			const input = {
					id: randomUUID(),
					fileId: fixture.image,
					imageHash: doc.image.imageHash,
					geometry: geometries[index],
					metadata,
				},
				key = randomUUID();
			const item = await requireData(
				await call(a, `${O}/annotations`, "POST", input, { key }),
				201,
			);
			created.push(item);
			assert.equal(item.revision, 1);
			if (index === 0) {
				lineInput = input;
				assert.deepEqual(
					await requireData(
						await call(a, `${O}/annotations`, "POST", input, { key }),
						201,
					),
					item,
				);
				assert.equal(
					(
						await call(
							a,
							`${O}/annotations`,
							"POST",
							{ ...input, metadata: meta("异载荷") },
							{ key },
						)
					).status,
					409,
				);
			}
		}
		[line, circle, point, text] = created;
	});
	await check("owner-isolation-and-guest-write-denials", async () => {
		assert.equal(
			(await call(b, `${O}/files/${fixture.image}/annotations`)).status,
			404,
		);
		assert.equal(
			(
				await call(b, `/api/projects/${fixture.projectB}/annotations`, "POST", {
					...lineInput,
					id: randomUUID(),
				})
			).status,
			404,
		);
		for (const [method, path, data] of [
			["POST", `${G}/annotations`, { ...lineInput, id: randomUUID() }],
			[
				"PATCH",
				`${G}/annotations/${line.id}`,
				{
					geometry: line.geometry,
					metadata: line.metadata,
					imageHash: doc.image.imageHash,
				},
			],
			["DELETE", `${G}/annotations/${line.id}`, undefined],
		])
			assert.equal(
				(await call(g, path, method, data, { revision: 1 })).status,
				403,
			);
		assert.equal(
			(await call(g, `${G}/annotations/${line.id}/revisions`)).status,
			403,
		);
		assert.equal(
			(
				await call(
					g,
					`/api/guest/projects/${fixture.projectB}/files/${fixture.image}/annotations`,
				)
			).status,
			401,
		);
	});
	await check(
		"strict-validation-image-version-and-no-pixel-dimensions",
		async () => {
			for (const [input, status] of [
				[
					{
						...lineInput,
						id: randomUUID(),
						geometry: { type: "point", at: { x: 1.1, y: 0.3 } },
					},
					422,
				],
				[
					{
						...lineInput,
						id: randomUUID(),
						geometry: { ...circle.geometry, radiusY: circle.geometry.radiusX },
					},
					422,
				],
				[
					{
						...lineInput,
						id: randomUUID(),
						metadata: { ...line.metadata, source: "pixels" },
					},
					422,
				],
				[{ ...lineInput, id: randomUUID(), ownerId: "forged" }, 422],
				[{ ...lineInput, id: randomUUID(), imageHash: "0".repeat(64) }, 409],
				[{ ...lineInput, id: randomUUID(), fileId: fixture.attachment }, 409],
			])
				assert.equal(
					(await call(a, `${O}/annotations`, "POST", input)).status,
					status,
				);
			assert.equal(point.metadata.dimension, "");
			assert.equal(text.metadata.dimension, "");
		},
	);
	await check("edit-revision-conflict-and-immutable-old-snapshot", async () => {
		const changed = {
			geometry: { ...line.geometry, from: { x: 0.3, y: 0.65 } },
			metadata: { ...line.metadata, notes: "第二修订" },
			imageHash: doc.image.imageHash,
		};
		line = await requireData(
			await call(a, `${O}/annotations/${line.id}`, "PATCH", changed, {
				revision: 1,
			}),
		);
		assert.equal(line.revision, 2);
		assert.equal(line.metadata.dimension, "12.5");
		assert.equal(
			(
				await call(a, `${O}/annotations/${line.id}`, "PATCH", changed, {
					revision: 1,
				})
			).status,
			409,
		);
		assert.equal(
			(await call(a, `${O}/annotations/${line.id}`, "PATCH", changed)).status,
			428,
		);
		const revisions = await requireData(
			await call(a, `${O}/annotations/${line.id}/revisions`),
		);
		assert.equal(revisions.items.length, 2);
		assert.deepEqual(revisions.items[1].geometry, lineInput.geometry);
	});
	await check(
		"soft-delete-tombstone-and-restoration-as-new-revision",
		async () => {
			const deleted = await requireData(
				await call(a, `${O}/annotations/${line.id}`, "DELETE", undefined, {
					revision: 2,
				}),
			);
			assert.equal(deleted.deleted, true);
			assert.equal(deleted.revision, 3);
			const guest = await requireData(
				await call(g, `${G}/files/${fixture.image}/annotations`),
			);
			assert.ok(!guest.items.some((i) => i.id === line.id));
			line = await requireData(
				await call(
					a,
					`${O}/annotations/${line.id}`,
					"PATCH",
					{
						geometry: line.geometry,
						metadata: line.metadata,
						imageHash: doc.image.imageHash,
					},
					{ revision: 3 },
				),
			);
			assert.equal(line.deleted, false);
			assert.equal(line.revision, 4);
			const revisions = await requireData(
				await call(a, `${O}/annotations/${line.id}/revisions`),
			);
			assert.equal(revisions.items.length, 4);
			assert.equal(revisions.items[1].deleted, true);
		},
	);
	await check("new-session-restores-real-saved-annotations", async () => {
		const fresh = await context("A");
		contexts.push(fresh);
		const restored = await requireData(
			await call(fresh, `${O}/files/${fixture.image}/annotations`),
		);
		assert.ok(
			[line, circle, point, text].every((item) =>
				restored.items.some((saved) => saved.id === item.id && !saved.deleted),
			),
		);
		assert.deepEqual(
			restored.items.find((i) => i.id === circle.id).geometry,
			circle.geometry,
		);
		assert.equal(
			restored.items.find((i) => i.id === line.id).metadata.dimension,
			"12.5",
		);
	});
	await check(
		"independent-file-comment-owner-create-guest-read-and-denial",
		async () => {
			const key = randomUUID(),
				input = {
					fileId: fixture.attachment,
					title: "请核对附件包含哪些零件",
					description: "文件级文字问题，不建立几何对象，也不接收测量回复。",
				};
			const issue = await requireData(
				await call(a, `${O}/issues`, "POST", input, { key }),
				201,
			);
			assert.deepEqual(
				await requireData(
					await call(a, `${O}/issues`, "POST", input, { key }),
					201,
				),
				issue,
			);
			const list = await requireData(
				await call(g, `${G}/files/${fixture.attachment}/issues`),
			);
			assert.equal(list.items[0].id, issue.id);
			assert.equal(list.items[0].kind, "comment");
			assert.equal(list.items[0].annotationId, undefined);
			assert.equal((await call(g, `${G}/issues`, "POST", input)).status, 403);
			assert.equal(
				(
					await call(
						b,
						`/api/projects/${fixture.projectB}/issues`,
						"POST",
						input,
					)
				).status,
				404,
			);
		},
	);
	await check("history-referenced-files-cannot-be-hidden", async () => {
		for (const file of [fixture.image, fixture.attachment]) {
			const response = await call(a, `${O}/files/${file}`, "DELETE");
			assert.equal(response.status, 409);
			assert.equal(response.code, "HISTORY_PROTECTED");
		}
	});
	await check("concurrent-authorized-readers", async () => {
		const reads = await Promise.all(
			Array.from({ length: 6 }, (_, i) =>
				call(
					i % 2 ? g : a,
					`${i % 2 ? G : O}/files/${fixture.image}/annotations`,
				),
			),
		);
		assert.ok(reads.every((r) => r.status === 200));
	});
	await check("revocation-denies-new-annotation-and-file-reads", async () => {
		const detail = await requireData(await call(a, O));
		await requireData(
			await call(a, `${O}/share-links/${detail.share.id}`, "DELETE"),
		);
		assert.equal(
			(await call(g, `${G}/files/${fixture.image}/annotations`)).status,
			401,
		);
		assert.equal(
			(await call(g, `${G}/files/${fixture.image}/preview`)).status,
			401,
		);
	});
	const share = await requireData(
		await call(a, `${O}/share-links`, "POST", {}),
		201,
	);
	fixture.shareUrl = share.url;
	fixture.line = line?.id;
	fixture.circle = circle?.id;
	await requireData(
		await call(g, "/api/guest/session", "POST", {
			token: share.url.split("/").pop(),
		}),
	);
	await g.storageState({ path: "tmp/p0-2/guest.json" });
	await writeFile("tmp/p0-2/fixture.json", JSON.stringify(fixture));
	await writeFile(
		"tmp/p0-2/manual-entry.txt",
		`Owner: http://127.0.0.1:3000/projects/${fixture.projectA}\nGuest (secret; do not commit): ${share.url}\nPasswords: D:/PartMeasure/tmp/p0-1/test-passwords.txt\n`,
	);
} catch {
	results.push({ check: "suite-prerequisite", status: "FAIL" });
} finally {
	await Promise.all(contexts.map((c) => c.dispose()));
}
await writeFile(
	"docs/evidence/p0-2/api.json",
	`${JSON.stringify({ checkedAt: new Date().toISOString(), realService: true, results }, null, 2)}\n`,
);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
