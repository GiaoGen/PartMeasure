import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { context, call, requireData, root } from "./helpers.mjs";
const f = JSON.parse(await readFile("tmp/p0-4/fixture.json", "utf8")),
	a = await context("A"),
	O = `/api/projects/${f.projectA}`;
let report;
const previous = JSON.parse(
	await readFile("tmp/p0-4/header-probe.json", "utf8").catch(() => "null"),
);
try {
	const d = requireData(
		await call(a, `${O}/deliveries`, "POST", {
			description: "HTTPS 条件头复现",
			fileIds: [f.file1.id],
		}),
		201,
	);
	const key = randomUUID();
	const legacy = process.argv.includes("--legacy");
	const csrf = await (await a.get("/api/csrf")).json();
	const changedResponse = await a.patch(`${O}/deliveries/${d.id}`, {
		data: { description: "HTTPS 修改已提交证据", fileIds: [f.file1.id] },
		headers: {
			origin: root,
			"x-csrf-token": csrf.data.token,
			"Idempotency-Key": key,
			[legacy ? "If-Match" : "X-PM-Revision"]: '"1"',
		},
	});
	const changed = {
		status: changedResponse.status(),
		response: changedResponse,
	};
	const saved = requireData(await call(a, `${O}/deliveries/${d.id}`));
	report = {
		root,
		status: changed.status,
		contentType: changed.response.headers()["content-type"] ?? null,
		hasEtag: !!changed.response.headers().etag,
		revisionAfter: saved.revision,
		expectedDescriptionPersisted: saved.description === "HTTPS 修改已提交证据",
		legacy,
	};
	if (!legacy) {
		assert.equal(changed.status, 200);
		assert.equal(saved.revision, 2);
		const stale = await call(
			a,
			`${O}/deliveries/${d.id}`,
			"PATCH",
			{ description: "stale", fileIds: [f.file1.id] },
			{ revision: 1 },
		);
		assert.equal(stale.status, 409);
		assert.equal(stale.code, "REVISION_CONFLICT");
		report.staleRevisionRejected = true;
		if (previous) {
			const oldPath = `/api/projects/${previous.project}/deliveries/${previous.draft}`;
			const before = requireData(await call(a, oldPath));
			const replay = requireData(
				await call(
					a,
					oldPath,
					"PATCH",
					{ description: "HTTPS 修改已提交证据", fileIds: [previous.file] },
					{ key: previous.key, revision: 1 },
				),
			);
			const after = requireData(await call(a, oldPath));
			assert.equal(replay.revision, 2);
			assert.equal(after.revision, before.revision);
			report.unknownResultRecoveredWithoutDuplicateRevision = true;
		}
	}
	await writeFile(
		"tmp/p0-4/header-probe.json",
		JSON.stringify({ project: f.projectA, draft: d.id, key, file: f.file1.id }),
	);
} finally {
	await a.dispose();
}
await writeFile(
	process.argv.includes("--legacy")
		? "docs/evidence/p0-4/https-precondition-legacy.json"
		: "docs/evidence/p0-4/https-precondition-after.json",
	`${JSON.stringify(report, null, 2)}\n`,
);
console.log(report);
