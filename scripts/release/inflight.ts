// Actual app file stream + real Guest RLS/Storage. Controlled consumer pause, no fake bytes/clock.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import nextEnv from "@next/env";
import { digest, getPool } from "../../src/lib/server/db";
import { fileResponse } from "../../src/lib/server/file-response";
import { fileAuthorizer } from "../../src/lib/server/file-authorizer";
import { releaseSource } from "./fingerprint";
import { connectionFailure } from "../maintenance/connection-model";
import { AppError } from "../../src/lib/policy";
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const run = process.argv[2]; assert.match(run ?? "", /^[a-f0-9-]{36}$/);
const directory = `tmp/p3-05/${run}`, state = JSON.parse(await readFile(`${directory}/state.json`, "utf8"));
assert.equal(state.scope.source, releaseSource().digest);
assert.equal(state.operations.share?.status, "done"); assert.equal(state.operations.guest1?.status, "done");
assert.equal(state.operations.revoke, undefined);
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname, "rvysclscetfqicpnzlra.supabase.co");
const cookie = state.guestStorage.cookies.find((c: { name: string }) => c.name === `pm_guest_${state.scope.project.id}`);
assert.match(cookie?.value ?? "", /^[A-Za-z0-9_-]{43}$/);
const actor = { kind: "guest" as const, hash: digest(cookie.value) };
const evidence: Record<string, unknown> = { run, source: state.scope.source, scope: "Real authenticated Guest session, actual fileResponse/fileAuthorizer/RLS/Storage; controlled paused consumer, real time. Service-layer stream, not browser HTTP/phone/hosted evidence." };
let stage = "construct_authorizer";
let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
try {
	const authorizeFile = await fileAuthorizer(actor, state.scope.project.id, state.scope.pdf.id);
	let authorizationFailure: { code: string; status: number } | undefined;
	const authorize = async () => {
		stage = "real_file_authorization";
		const started = Date.now();
		try {
			const file = await authorizeFile();
			evidence.authorizationChecks = [...(evidence.authorizationChecks as object[] ?? []), { status: "PASS", milliseconds: Date.now() - started }];
			stage = "private_storage_or_stream_setup";
			return file;
		}
		catch (error) {
			if (error instanceof AppError) authorizationFailure = { code: error.code, status: error.status };
			throw error;
		}
	};
	stage = "storage_and_initial_file_stream";
	const response = await fileResponse(new Request("http://127.0.0.1:3105/controlled-inflight", { signal: AbortSignal.timeout(90000) }), authorize);
	assert.equal(response.status, 200); reader = response.body?.getReader(); assert.ok(reader);
	stage = "read_first_chunk";
	const first = await reader.read(); assert.equal(first.done, false); assert.ok(first.value && first.value.length > 0);
	evidence.firstChunkBytes = first.value.length;
	await writeFile(`${directory}/inflight-ready`, "ready", { flag: "wx" });
	stage = "wait_for_actual_revoke"; const start = Date.now();
	for (;;) {
		try { await readFile(`${directory}/inflight-revoked`); break; } catch { /* Local synchronization only. */ }
		assert.ok(Date.now() - start < 60000, "REVOKE_NOT_CONFIRMED"); await new Promise(resolve => setTimeout(resolve, 100));
	}
	// Real elapsed time ensures the app's five-second authorization checkpoint is crossed.
	await new Promise(resolve => setTimeout(resolve, 5100));
	stage = "next_chunk_after_revoke";
	const activeReader = reader;
	await assert.rejects(() => activeReader.read(), /PRIVATE_DOWNLOAD_INTERRUPTED/);
	// Network/503 interruptions must never satisfy a revocation assertion.
	assert.deepEqual(authorizationFailure, { code: "LINK_UNAVAILABLE", status: 401 });
	evidence.authorizationFailure = authorizationFailure;
	evidence.status = "PASS"; evidence.elapsedMsAfterFirstChunk = Date.now() - start; evidence.additionalChunkReleased = false;
} catch (error) {
	const known = error as { name?: string; code?: string; message?: string; cause?: { name?: string; code?: string } };
	evidence.status = "NOT_PASSED";
	evidence.failure = { stage, ...connectionFailure(error), errorClass: known.name,
		sqlState: /^[0-9A-Z]{5}$/.test(known.code ?? "") ? known.code : null,
		queryReadTimeout: known.message === "Query read timeout",
		poolAcquisitionTimeout: known.message === "timeout exceeded when trying to connect",
		causeClass: known.cause?.name, causeCode: /^[A-Z0-9_]{2,50}$/.test(known.cause?.code ?? "") ? known.cause?.code : null,
	}; process.exitCode = 1;
}
finally {
	await reader?.cancel().catch(() => {}); await getPool().end().catch(() => {});
	await writeFile(`docs/evidence/p3-05/batch-${run}-inflight.json`, `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(JSON.stringify(evidence));
