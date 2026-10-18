// Dedicated, visibly tagged projects. No existing project/fixture is modified or deleted.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import {
	context,
	call,
	requireData,
	saveReport,
	safeCode,
	root,
} from "./helpers.mjs";
const results = [],
	contexts = [];
let a, b, g, f;
async function check(name, work) {
	process.stdout.write(`start: ${name}\n`);
	try {
		await work();
		results.push({ check: name, status: "PASS" });
	} catch (e) {
		results.push({
			check: name,
			status: "FAIL",
			code: safeCode(e),
			frames: e.stack
				?.split("\n")
				.filter((x) => x.trim().startsWith("at ") && !x.includes("http"))
				.slice(0, 4),
			causeCode: e.cause?.code,
		});
	}
	await saveReport("api-progress", results);
	process.stdout.write(`${name}: ${results.at(-1).status}\n`);
}
async function upload(c, prefix, filename, bytes, purpose) {
	const digest = createHash("sha256").update(bytes).digest("hex");
	const r = requireData(
		await call(c, `${prefix}/uploads`, "POST", {
			filename,
			byteSize: bytes.length,
			declaredMime: filename.endsWith(".png")
				? "image/png"
				: "application/octet-stream",
			sha256: digest,
			...(purpose ? { purpose } : {}),
		}),
		201,
	);
	const grant = requireData(
		await call(c, `${prefix}/uploads/${r.id}/grant`, "POST", {}),
	);
	if (!grant.state) {
		const res = await fetch(grant.signedUrl, {
			method: "PUT",
			headers: {
				"Content-Type": filename.endsWith(".png")
					? "image/png"
					: "application/octet-stream",
				"x-upsert": "false",
			},
			body: bytes,
			signal: AbortSignal.timeout(90000),
		});
		assert.ok(res.ok);
	}
	requireData(
		await call(c, `${prefix}/uploads/${r.id}/complete`, "POST", {}),
		202,
	);
	const deadline = Date.now() + 300000;
	while (Date.now() < deadline) {
		const state = requireData(await call(c, `${prefix}/uploads/${r.id}`));
		if (state.state === "ready")
			return { id: r.id, sha256: digest, bytes: bytes.length };
		if (state.state === "rejected" || state.state === "cleaned")
			throw Error("UPLOAD_REJECTED");
		await new Promise((r) => setTimeout(r, 2500));
	}
	throw Error("PROCESSING_TIMEOUT");
}
try {
	await check("normal-A-B-auth-and-independent-P04-projects", async () => {
		a = await context("A");
		b = await context("B");
		g = await context();
		contexts.push(a, b, g);
		const stamp = Date.now(),
			p = requireData(
				await call(a, "/api/projects", "POST", {
					name: `P0-4 自动验证 ${stamp}`,
					description: "独立合成验证资料；不代表真实工程数据",
				}),
				201,
			),
			other = requireData(
				await call(b, "/api/projects", "POST", {
					name: `P0-4 隔离 B ${stamp}`,
					description: "隔离验证",
				}),
				201,
			);
		const share = requireData(
			await call(a, `/api/projects/${p.id}/share-links`, "POST", {}),
			201,
		);
		requireData(
			await call(g, "/api/guest/session", "POST", {
				token: share.url.split("/").pop(),
			}),
		);
		f = {
			projectA: p.id,
			projectB: other.id,
			shareId: share.id,
			shareUrl: share.url,
			stamp,
		};
		await writeFile("tmp/p0-4/fixture.json", JSON.stringify(f));
	});
	if (!f) throw Error("PREREQUISITE");
	const O = `/api/projects/${f.projectA}`,
		G = `/api/guest/projects/${f.projectA}`,
		B = `/api/projects/${f.projectB}`;
	await check("real-material-and-owner-private-delivery-pipeline", async () => {
		const img = await sharp({
			create: { width: 800, height: 500, channels: 3, background: "#d5dde6" },
		})
			.composite([
				{
					input: Buffer.from(
						`<svg width="800" height="500"><circle cx="200" cy="170" r="55" fill="white" stroke="black"/><text x="30" y="460">Synthetic P04 ${f.stamp}</text></svg>`,
					),
				},
			])
			.png()
			.toBuffer();
		f.material = await upload(g, G, `p04-material-${f.stamp}.png`, img);
		const step = Buffer.from(
			`ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('SYNTHETIC P04 ${f.stamp}'),'2;1');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n`,
		);
		f.file1 = await upload(
			a,
			O,
			`p04-delivery-${f.stamp}.step`,
			step,
			"delivery",
		);
		f.file2 = await upload(
			a,
			O,
			`p04-delivery-${f.stamp}.png`,
			img,
			"delivery",
		);
		f.otherFile = await upload(
			b,
			B,
			`p04-other-${f.stamp}.step`,
			Buffer.concat([step, Buffer.from("\nB")]),
			"delivery",
		);
		assert.equal(
			(await call(g, `${G}/files/${f.file1.id}/download`)).status,
			404,
		);
		assert.ok(
			!requireData(await call(g, `${G}/files`)).items.some(
				(x) => x.id === f.file1.id,
			),
		);
		assert.ok(
			requireData(await call(a, `${O}/files?purpose=delivery`)).items.some(
				(x) => x.id === f.file1.id,
			),
		);
	});
	let draft;
	await check(
		"private-draft-persistence-CAS-idempotency-and-attachment-boundaries",
		async () => {
			const input = {
					description: "首轮明确成果集合",
					fileIds: [f.file1.id, f.file2.id],
				},
				key = randomUUID();
			draft = requireData(
				await call(a, `${O}/deliveries`, "POST", input, { key }),
				201,
			);
			assert.equal(
				requireData(
					await call(a, `${O}/deliveries`, "POST", input, { key }),
					201,
				).id,
				draft.id,
			);
			assert.equal(
				(
					await call(
						a,
						`${O}/deliveries`,
						"POST",
						{ ...input, description: "变更" },
						{ key },
					)
				).status,
				409,
			);
			assert.equal((await call(g, `${G}/deliveries/${draft.id}`)).status, 404);
			assert.deepEqual(requireData(await call(g, `${G}/deliveries`)), {
				published: null,
				drafts: [],
			});
			const saved = requireData(
				await call(
					a,
					`${O}/deliveries/${draft.id}`,
					"PATCH",
					{ ...input, description: "已持久化说明" },
					{ revision: 1 },
				),
			);
			assert.equal(saved.revision, 2);
			draft = saved;
			assert.equal(
				(
					await call(a, `${O}/deliveries/${draft.id}`, "PATCH", input, {
						revision: 1,
					})
				).status,
				409,
			);
			for (const fileId of [f.otherFile.id, f.material.id, randomUUID()])
				assert.equal(
					(
						await call(a, `${O}/deliveries`, "POST", {
							description: "非法文件不得保存",
							fileIds: [fileId],
						})
					).status,
					422,
				);
			assert.equal(
				requireData(await call(a, `${O}/deliveries/${draft.id}`)).description,
				"已持久化说明",
			);
		},
	);
	await check(
		"atomic-multi-file-publication-replay-and-no-overwrite",
		async () => {
			const key = randomUUID(),
				pub = requireData(
					await call(
						a,
						`${O}/deliveries/${draft.id}/publish`,
						"POST",
						{},
						{ revision: 2, key },
					),
					201,
				);
			assert.equal(pub.versionNo, 1);
			assert.equal(pub.files.length, 2);
			f.delivery1 = pub.id;
			const replay = requireData(
				await call(
					a,
					`${O}/deliveries/${draft.id}/publish`,
					"POST",
					{},
					{ revision: 2, key },
				),
				201,
			);
			assert.equal(replay.id, pub.id);
			assert.equal(
				(
					await call(
						a,
						`${O}/deliveries/${pub.id}/publish`,
						"POST",
						{},
						{ revision: 2 },
					)
				).status,
				409,
			);
			assert.equal(
				(
					await call(
						a,
						`${O}/deliveries/${pub.id}`,
						"PATCH",
						{ description: "覆盖", fileIds: [] },
						{ revision: 3 },
					)
				).status,
				409,
			);
			for (const file of pub.files)
				assert.equal(
					(await call(a, `${O}/files/${file.id}`, "DELETE", {})).status,
					409,
				);
			const visible = requireData(await call(g, `${G}/deliveries`));
			assert.equal(visible.published.id, pub.id);
			assert.equal(visible.published.files.length, 2);
			const downloaded = await g.get(
				`${G}/deliveries/${pub.id}/files/${f.file1.id}/download`,
			);
			assert.equal(downloaded.status(), 200);
			assert.equal(
				createHash("sha256")
					.update(await downloaded.body())
					.digest("hex"),
				f.file1.sha256,
			);
			f.downloadHeaderSafe =
				!downloaded.headers().location &&
				downloaded.headers()["cache-control"].includes("no-store");
			assert.ok(f.downloadHeaderSafe);
		},
	);
	await check(
		"guest-management-denied-owner-isolation-and-project-file-scope",
		async () => {
			assert.equal(
				(
					await call(g, `${G}/uploads`, "POST", {
						filename: "x.step",
						byteSize: 100,
						declaredMime: "",
						sha256: "a".repeat(64),
						purpose: "delivery",
					})
				).status,
				403,
			);
			assert.equal((await call(g, `${G}/files?purpose=delivery`)).status, 403);
			for (const [method, path, data] of [
				["POST", `${G}/deliveries`, { description: "forged", fileIds: [] }],
				["POST", `${G}/deliveries/${f.delivery1}/publish`, {}],
				[
					"PATCH",
					`${G}/deliveries/${f.delivery1}`,
					{ description: "forged", fileIds: [] },
				],
			])
				assert.equal(
					(await call(g, path, method, data, { revision: 1 })).status,
					403,
				);
			assert.equal((await call(b, `${O}/deliveries`)).status, 404);
			assert.equal(
				(await call(b, `${O}/deliveries/${f.delivery1}`)).status,
				404,
			);
			assert.equal(
				(
					await call(
						g,
						`${G}/deliveries/${f.delivery1}/files/${f.otherFile.id}/download`,
					)
				).status,
				404,
			);
			assert.equal(
				(
					await call(
						g,
						`${G}/deliveries/${f.delivery1}/files/${f.material.id}/download`,
					)
				).status,
				404,
			);
		},
	);
	await check(
		"concurrent-publish-single-winner-and-new-version-retains-old",
		async () => {
			const d = requireData(
				await call(a, `${O}/deliveries`, "POST", {
					description: "第二轮不可覆盖第一轮",
					fileIds: [f.file1.id],
				}),
				201,
			);
			const r = await Promise.all([
				call(a, `${O}/deliveries/${d.id}/publish`, "POST", {}, { revision: 1 }),
				call(a, `${O}/deliveries/${d.id}/publish`, "POST", {}, { revision: 1 }),
			]);
			assert.deepEqual(r.map((x) => x.status).sort(), [201, 409]);
			f.delivery2 = r.find((x) => x.status === 201).data.id;
			assert.equal(r.find((x) => x.status === 201).data.versionNo, 2);
			assert.equal(
				requireData(await call(g, `${G}/deliveries`)).published.id,
				f.delivery2,
			);
			assert.equal(
				requireData(await call(g, `${G}/deliveries/${f.delivery1}`)).files
					.length,
				2,
			);
			assert.equal(
				(
					await g.get(
						`${G}/deliveries/${f.delivery1}/files/${f.file1.id}/download`,
						{ headers: { Range: "bytes=0-15" } },
					)
				).status(),
				206,
			);
		},
	);
	await check(
		"fresh-normal-session-restores-and-revocation-denies-existing-session-download",
		async () => {
			// Reuse the normally authenticated cookies; independent browser context, no extra login quota.
			const fresh = await (await import("@playwright/test")).request.newContext(
				{ baseURL: root, storageState: await a.storageState() },
			);
			contexts.push(fresh);
			assert.equal(
				requireData(await call(fresh, `${O}/deliveries`)).published.id,
				f.delivery2,
			);
			requireData(await call(a, `${O}/share-links/${f.shareId}`, "DELETE", {}));
			assert.equal((await call(g, `${G}/deliveries`)).status, 401);
			assert.equal(
				(
					await g.get(
						`${G}/deliveries/${f.delivery1}/files/${f.file1.id}/download`,
					)
				).status(),
				401,
			);
			const share = requireData(
				await call(a, `${O}/share-links`, "POST", {}),
				201,
			);
			f.shareUrl = share.url;
			f.shareId = share.id;
		},
	);
} catch (e) {
	results.push({
		check: "suite-prerequisite",
		status: "FAIL",
		code: safeCode(e),
		frames: e.stack
			?.split("\n")
			.filter((x) => x.trim().startsWith("at ") && !x.includes("http"))
			.slice(0, 4),
		causeCode: e.cause?.code,
	});
} finally {
	if (f) await writeFile("tmp/p0-4/fixture.json", JSON.stringify(f));
	await Promise.all(contexts.map((c) => c.dispose()));
}
await saveReport("api", results, {
	synthetic: true,
	isolatedTaggedProjects: true,
	mailRegistration: false,
});
if (results.some((x) => x.status === "FAIL")) process.exitCode = 1;
