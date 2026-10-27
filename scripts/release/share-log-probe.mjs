// No request by default. --apply requires explicit approval for this sensitive-path/logging test.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const run = "d700b91c-ea96-4114-8fad-d5f14f1b25b0", dir = `tmp/p3-05/${run}`;
const apply = process.argv[2] === "--apply"; assert.equal(process.argv.length, apply ? 3 : 2);
const state = JSON.parse(await readFile(`${dir}/state.json`, "utf8"));
assert.equal(state.operations.revoke?.status, "done");
const url = new URL(state.operations.share.value.url);
assert.equal(url.origin, "https://partmeasure-staging-gre1b1crp-messup-s-projects.vercel.app");
assert.match(url.pathname, /^\/s\/[A-Za-z0-9_-]{43}$/);
const tokenHash = createHash("sha256").update(url.pathname.split("/").at(-1)).digest("hex");
const report = { at: new Date().toISOString(), run, tokenHash,
	scope: "Exactly one GET of this batch already-revoked share landing URL, no JS/bootstrap/new Guest or writes. Then inspect hosted logs; raw URL/token never enters evidence.",
	risk: "The hosting provider may collect the revoked capability in its request path logs. This is the specific additional exposure requiring approval.",
	status: apply ? "REQUEST_PENDING" : "PROPOSED_REQUIRES_EXPLICIT_APPROVAL", requestsSent: 0,
};
if (apply) {
	await writeFile(`${dir}/share-log-probe-pending`, "pending", { flag: "wx" });
	const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
	await response.body?.cancel();
	Object.assign(report, { status: "REQUEST_SENT_LOG_REVIEW_PENDING", requestsSent: 1, httpStatus: response.status, requestId: response.headers.get("x-vercel-id"), cacheControl: response.headers.get("cache-control"), referrerPolicy: response.headers.get("referrer-policy") });
}
await writeFile(`docs/evidence/p3-05/share-log-${apply ? "request" : "scope"}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
