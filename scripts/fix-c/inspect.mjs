// Read-only reconciliation through the batch's normal, real application sessions.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const run = process.argv[2];
assert.match(run ?? "", /^[a-f0-9-]{36}$/);
const state = JSON.parse(await readFile(`tmp/fix-c/${run}/state.json`, "utf8"));
const project = state.operations.project?.value;
assert.equal(project?.name, `FIX-C-${run}`);
const cookie = Object.entries(state.cookies.A ?? {}).map(([k,v]) => `${k}=${v}`).join("; ");
const results = [];
for (const key of ["image", "v1", "v2", "private"]) {
	const file = state.operations[`reserve-${key}`]?.value;
	if (!file) continue;
	const start = performance.now();
	const response = await fetch(`http://127.0.0.1:3000/api/projects/${project.id}/uploads/${file.id}`, { headers: { cookie }, redirect: "error", signal: AbortSignal.timeout(45000) });
	const value = await response.json(), upload = value.data;
	const known = ["PROCESSING_INTERRUPTED", "PROCESSING_EXPIRED", "PROCESSING_ACTIVE", "STORAGE_UNAVAILABLE", "UPLOAD_OBJECT_NOT_FOUND", "HASH_OR_SIZE_MISMATCH", "DEPENDENCY_UNAVAILABLE", "DATABASE_TIMEOUT", "DATABASE_BUSY"];
	results.push({ asset: key, httpStatus: response.status, state: upload?.state ?? null, errorCode: known.includes(upload?.errorCode) ? upload.errorCode : upload?.errorCode ? "OTHER_REDACTED" : null,
		milliseconds: Math.round(performance.now() - start), timing: response.headers.get("server-timing") });
	if (!response.ok) break;
}
const report = { checkedAt: new Date().toISOString(), run, scope: "Read-only normal Owner API upload status; no retry/write/admin/Storage enumeration", results };
await writeFile(`docs/evidence/fix-c/${run}-upload-inspect-${Date.now()}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
