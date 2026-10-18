import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { context, call, requireData, saveReport } from "./helpers.mjs";
const f = JSON.parse(await readFile("tmp/p0-4/fixture.json", "utf8")),
	g = await context(),
	results = [];
try {
	requireData(
		await call(g, "/api/guest/session", "POST", {
			token: f.shareUrl.split("/").pop(),
		}),
	);
	const path = `/api/guest/projects/${f.projectA}/deliveries/${f.delivery1}/files/${f.file1.id}/download`;
	const bytes = await g.get(path, { headers: { Range: "bytes=0-15" } });
	assert.equal(bytes.status(), 206);
	assert.equal((await bytes.body()).length, 16);
	assert.ok(bytes.headers()["content-range"].startsWith("bytes 0-15/"));
	assert.equal(bytes.headers().location, undefined);
	const invalid = await g.get(path, { headers: { Range: "bytes=999999999-" } });
	assert.equal(invalid.status(), 416);
	assert.ok(invalid.headers()["content-range"].startsWith("bytes */"));
	const all = await g.get(path);
	assert.equal(
		createHash("sha256")
			.update(await all.body())
			.digest("hex"),
		f.file1.sha256,
	);
	const publicURL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/partmeasure-private/${f.projectA}/${f.file1.id}/source`;
	const publicRead = await fetch(publicURL, {
		signal: AbortSignal.timeout(45000),
	});
	assert.ok(!publicRead.ok);
	await publicRead.body?.cancel();
	results.push({
		check: "private-public-denial-real-range-416-and-byte-integrity",
		status: "PASS",
		publicDeniedStatus: publicRead.status,
	});
} catch (e) {
	results.push({
		check: "private-public-denial-real-range-416-and-byte-integrity",
		status: "FAIL",
		code: e.name,
	});
} finally {
	await g.dispose();
}
await saveReport("transfer", results);
console.log(results.map((x) => ({ check: x.check, status: x.status })));
if (results.some((x) => x.status === "FAIL")) process.exitCode = 1;
