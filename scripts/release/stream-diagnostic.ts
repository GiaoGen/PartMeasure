// One read-only diagnosis. Auth identity comes from the real candidate's normal Owner cookie.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import nextEnv from "@next/env";
import { getPool } from "../../src/lib/server/db";
import { fileForRead } from "../../src/lib/server/service";
import { fileResponse } from "../../src/lib/server/file-response";
import { connectionFailure, connectionTarget } from "../maintenance/connection-model";
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} }); connectionTarget(process.env);
const run = "d700b91c-ea96-4114-8fad-d5f14f1b25b0";
const state = JSON.parse(await readFile(`tmp/p3-05/${run}/state.json`, "utf8"));
const evidence: Record<string, unknown> = { checkedAt: new Date().toISOString(), run, scope: "One normal real Owner HTTP verification and local restricted DAL metadata read. No Storage bytes, business writes, new session/share or network changes; not Guest/inflight acceptance." };
let phase = "normal_owner_http_identity";
const start = performance.now();
const bytes = process.argv[2] === "--first-chunk";
assert.ok(process.argv.length === (bytes ? 3 : 2));
try {
	const response = await fetch(`${state.scope.root}/api/auth/session`, { headers: { cookie: state.ownerStorage.cookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join("; ") }, signal: AbortSignal.timeout(15000), redirect: "error" });
	assert.equal(response.status, 200); const identity = (await response.json()).data; assert.equal(identity.authenticated, true);
	phase = "restricted_DAL_file_metadata";
	const file = await fileForRead({ kind: "owner", id: identity.id }, state.scope.project.id, state.scope.pdf.id);
	assert.equal(file.id, state.scope.pdf.id); evidence.status = "PASS"; evidence.byteSize = Number(file.byte_size);
	if (bytes) {
		phase = "storage_sign_fetch_first_chunk";
		const content = await fileResponse(new Request("http://127.0.0.1:3105/diagnostic-first-chunk", { signal: AbortSignal.timeout(30000) }), () => fileForRead({ kind: "owner", id: identity.id }, state.scope.project.id, state.scope.pdf.id));
		assert.equal(content.status, 200); const reader = content.body?.getReader(); assert.ok(reader);
		try { const chunk = await reader.read(); assert.equal(chunk.done, false); evidence.firstChunkBytes = chunk.value?.length ?? 0; assert.ok(chunk.value?.length); }
		finally { await reader.cancel().catch(() => {}); }
		evidence.scope = "Normal Owner identity freshly verified over candidate HTTP; actual local fileResponse/RLS/private Storage first chunk, then canceled. Diagnostic only, not Guest or periodic Auth/revocation acceptance.";
	}
} catch (error) {
	const e = error as { name?: string; code?: string; message?: string; stack?: string; cause?: { name?: string; code?: string; errors?: { code?: string }[] } };
	const message = e.message ?? "";
	evidence.status = "NOT_PASSED";
	evidence.failure = { phase, ...connectionFailure(error), errorClass: e.name, sqlState: /^[0-9A-Z]{5}$/.test(e.code ?? "") ? e.code : null,
		messageCategory: /tenant or user not found/i.test(message) ? "pooler_tenant_or_user_not_found" : /circuit breaker/i.test(message) ? "pooler_circuit_breaker" : /upstream/i.test(message) ? "pooler_upstream" : /permission denied/i.test(message) ? "database_permission" : /query read timeout/i.test(message) ? "query_read_timeout" : /timeout/i.test(message) ? "timeout" : /request scope|cookies/i.test(message) ? "request_scope" : "other",
		localStackFrame: e.stack?.match(/(?:db|service|auth|stream-diagnostic)\.ts:\d+:\d+/)?.[0] ?? null,
		causeClass: e.cause?.name, causeCode: /^[A-Z0-9_]{2,50}$/.test(e.cause?.code ?? "") ? e.cause?.code : null,
		nestedCauseCodes: e.cause?.errors?.map(x => /^[A-Z0-9_]{2,50}$/.test(x.code ?? "") ? x.code : "OTHER"),
	}; process.exitCode = 1;
} finally { await getPool().end().catch(() => {}); }
evidence.milliseconds = Math.round(performance.now() - start);
await writeFile(`docs/evidence/p3-05/stream-${bytes ? "first-chunk" : "setup"}-diagnostic.json`, `${JSON.stringify(evidence, null, 2)}\n`); console.log(JSON.stringify(evidence));
