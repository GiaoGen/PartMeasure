// Resume the single approved target after database commit; never reimports SQL or overwrites objects.
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile, realpath, readdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { authenticatedBackup } from "../maintenance/restore";
import { backupKey } from "../maintenance/encrypted-file";
import { databaseClient } from "../maintenance/backup";
import { cancelDatabaseOnAbort } from "../maintenance/postgres-tools";
import { cloudTargetAllowed, userTokenColumns, recoveryIdentifier } from "../maintenance/cloud-recovery-model";
import { streamObjectReadback } from "../maintenance/stream-object-readback";
import { uploadOrConfirm } from "../maintenance/upload-confirmation";

const root = path.resolve("tmp/p3-05/recovery-cloud-8a60a0b7");
const target = "xuyghznbcahlauontcyq", sourceSet = "08c325c3-f646-42d0-b9c2-ad2d7e3cab69";
const signal = AbortSignal.timeout(90 * 60 * 1000);
let phase = "resume-configuration", activeBytes = 0, activeOrdinal = 0;
const counts = { objectsUploaded: 0, objectsVerified: 0, reusedUploadedObjects: 0, loginAttempts: 0 };
const progress = setInterval(() => console.log(JSON.stringify({ phase, ...counts, activeOrdinal, activeBytes })), 20000); progress.unref();
type Verified = { bytes: number; sha256: string };
const journalFile = path.join(root, "finish-state.json");
let journal: { target: string; sourceSet: string; verified: Record<string, Verified>; loginAttempted: boolean };
const save = () => writeFile(journalFile, JSON.stringify(journal), { mode: 0o600 });
const query = async (db: ReturnType<typeof databaseClient>, text: string, values?: unknown[]) => { signal.throwIfAborted(); return db.query(text, values); };

async function main() {
	const connectorMode = process.argv.length === 3 && process.argv[2] === "--connector-proof";
	assert.ok(connectorMode || process.argv.length === 2, "INVALID_FINISH_MODE");
	const scope = JSON.parse(await readFile("docs/evidence/p3-05/recovery-cloud-scope.json", "utf8"));
	const created = JSON.parse(await readFile("tmp/p3-05/recovery-cloud-created.json", "utf8"));
	const previous = JSON.parse(await readFile("docs/evidence/p3-05/recovery-cloud-failure.json", "utf8"));
	assert.equal(scope.status, "APPROVED"); assert.equal(scope.sourceSet, sourceSet); assert.equal(created.id, target); assert.equal(created.createdForThisRun, true);
	assert.equal(created.organization_id, scope.organization); assert.equal(created.region, scope.region); assert.equal(created.name, scope.projectName);
	assert.equal(previous.phase, "restore-private-object-bytes"); assert.equal(previous.loginAttempts, 0);
	try { journal = JSON.parse(await readFile(journalFile, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; journal = { target, sourceSet, verified: {}, loginAttempted: false }; await writeFile(journalFile, JSON.stringify(journal), { flag: "wx", mode: 0o600 }); }
	assert.equal(journal.target, target); assert.equal(journal.sourceSet, sourceSet); assert.equal(journal.loginAttempted, false, "LOGIN_AUTHORIZATION_CONSUMED");
	const config = JSON.parse(await readFile(path.join(root, "config.json"), "utf8")); assert.equal(config.targetRef, target);
	const url = new URL((await readFile(config.databaseUrlFile, "utf8")).trim());
	if (["[YOUR-PASSWORD]", "[YOUR_PASSWORD]", "YOUR_PASSWORD"].includes(decodeURIComponent(url.password))) url.password = (await readFile(path.join(root, "target-database-password.txt"), "utf8")).trim();
	assert.ok(cloudTargetAllowed(url, target), "UNAPPROVED_RESUME_TARGET");
	const candidates: string[] = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (entry.isDirectory() && /^apply-[a-f0-9]+$/.test(entry.name)) { const file = path.join(root, entry.name, "runtime-database-url.txt"); try { await access(file); candidates.push(file); } catch {} }
	}
	assert.equal(candidates.length, 1, "AMBIGUOUS_COMMITTED_RUNTIME_CREDENTIAL"); const runtimeFile = candidates[0]; assert.ok(runtimeFile);
	assert.ok((await realpath(runtimeFile)).startsWith(`${root}${path.sep}`));
	const runtimeUrl = new URL((await readFile(runtimeFile, "utf8")).trim()); assert.equal(runtimeUrl.hostname, url.hostname); assert.equal(runtimeUrl.port, url.port);
	assert.equal(decodeURIComponent(runtimeUrl.username), url.hostname.includes("pooler") ? `partmeasure_runtime.${target}` : "partmeasure_runtime");
	const secret = (await readFile(config.serviceKeyFile, "utf8")).trim(), publicKey = (await readFile(config.publishableKeyFile, "utf8")).trim();
	const endpoint = `https://${target}.supabase.co`;
	const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(600000), ...(init?.signal ? [init.signal] : [])]) }) } };
	const api = createClient(endpoint, secret, options);
	const state = JSON.parse(await readFile("tmp/fix-e/8a60a0b7-8450-4e41-8b43-2c58204660a8/state.json", "utf8"));
	const key = await backupKey(path.join(path.dirname(state.environment.PM_BACKUP_KEY_FILE), "from-phone.backup-key"));
	const copy = JSON.parse(await readFile("tmp/p3-05/recovery-drive-verified.json", "utf8")); assert.equal(copy.status, "PASS"); assert.equal(copy.phoneKeyCustodyVerified, true);
	const ca = await readFile(config.caFile, "utf8"), db = databaseClient(url, ca); db.on("error", () => {}); const stop = cancelDatabaseOnAbort(db, signal); let connected = false;
	try {
		await authenticatedBackup({ directory: copy.directory, workspace: path.join(root, `finish-authenticate-${Date.now()}`), key, signal }, async ({ manifest, staging }) => {
			assert.equal(manifest.projectRef, scope.sourceRef); assert.equal(manifest.objects.length, 192); assert.equal(manifest.migrations.length, 20); assert.equal(Object.keys(manifest.tables).length, 24);
			let existing: { name: string; bytes: string }[];
			if (connectorMode) {
				phase = "verify-connector-snapshot-proof";
				const proof = JSON.parse(await readFile(path.join(root, "connector-proof.json"), "utf8"));
				assert.equal(proof.status, "PASS"); assert.equal(proof.targetRef, target); assert.equal(proof.sourceSet, sourceSet);
				assert.equal(proof.hashesRechecked, 20); assert.equal(proof.rowCountsRechecked, 24);
				for (const row of proof.tables) { assert.equal(row.rows, manifest.tables[row.name]?.rows); if (row.sha256 !== null) assert.equal(row.sha256, manifest.tables[row.name]?.sha256); }
				existing = proof.existing;
			} else {
			phase = "resume-target-connect"; await db.connect(); connected = true; phase = "verify-resumed-database";
			await query(db, "begin read only; set local timezone='UTC'; set local statement_timeout='60000'");
			const intentionallyChanged = new Set(["share_links", "guest_sessions", "upload_reservations", "idempotency_keys"]);
			const pieces = Object.keys(manifest.tables).map(table => {
				const hash = intentionallyChanged.has(table) ? "null::text" : `encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text collate "C")||E'\\n',''),'UTF8')),'hex')`;
				return `select '${table}' as name,count(*)::int as rows,${hash} as sha256 from pm.${recoveryIdentifier(table)} t`;
			});
			const actual = (await query(db, pieces.join(" union all "))).rows;
			for (const row of actual) { assert.equal(row.rows, manifest.tables[row.name]?.rows, "RESUMED_TABLE_COUNT_MISMATCH"); if (!intentionallyChanged.has(row.name)) assert.equal(row.sha256, manifest.tables[row.name]?.sha256, "RESUMED_TABLE_HASH_MISMATCH"); }
			assert.equal(actual.length, 24);
			const gates = (await query(db, `select (select count(*)::int from auth.users) as users,(select count(*)::int from auth.identities) as identities,
			 (select count(*)::int from auth.sessions) as sessions,(select count(*)::int from auth.mfa_amr_claims) as claims,
			 (select count(*)::int from pm.share_links where revoked_at is null) as unrevoked,
			 (select count(*)::int from pm.guest_sessions where expires_at>now()) as active_guests,
			 (select count(*)::int from pm.upload_reservations where state in ('reserved','queued','processing')) as pending_uploads,
			 (select count(*)::int from pm.idempotency_keys where result<>'{"error":"RESTORE_REQUIRES_NEW_REQUEST"}'::jsonb or request_hash<>encode(sha256(convert_to(key::text||':restore:'||$1,'UTF8')),'hex')) as old_replays,
			 (select count(*)::int from auth.users where ${userTokenColumns.map(c => `coalesce(${recoveryIdentifier(c)},'')<>''`).join(" or ")}) as old_auth_tokens,
			 (select count(*)::int from supabase_migrations.schema_migrations) as migrations,
			 (select count(*)::int from pg_tables where schemaname='pm' and rowsecurity) as rls_tables,
			 (select count(*)::int from storage.buckets where public) as public_buckets` , [target])).rows[0];
			assert.deepEqual(gates, { users: 5, identities: 5, sessions: 0, claims: 0, unrevoked: 0, active_guests: 0, pending_uploads: 0, old_replays: 0, old_auth_tokens: 0, migrations: 20, rls_tables: 24, public_buckets: 0 });
			existing = (await query(db, "select name,(metadata->>'size')::bigint as bytes from storage.objects where bucket_id='partmeasure-private'")).rows;
			const expected = new Map(manifest.objects.map(o => [o.key, o]));
			for (const row of existing) { const object = expected.get(row.name); assert.ok(object, "UNEXPECTED_TARGET_OBJECT"); assert.equal(Number(row.bytes), object.bytes, "TARGET_OBJECT_SIZE_MISMATCH"); }
			await query(db, "rollback");
			counts.reusedUploadedObjects = existing.length; counts.objectsUploaded = existing.length;
			await writeFile("docs/evidence/p3-05/recovery-database-resume-verification.json", `${JSON.stringify({ checkedAt: new Date().toISOString(), status: "PASS", targetRef: target, unchangedTableHashesVerified: 20, tableRowCountsVerified: 24, intentionalCapabilityInvalidations: [...intentionallyChanged], gates, existingObjectCount: existing.length, sqlReimported: false }, null, 2)}\n`);
			}
			const expectedObjects = new Map(manifest.objects.map(o => [o.key, o]));
			for (const row of existing) { const object = expectedObjects.get(row.name); assert.ok(object, "UNEXPECTED_TARGET_OBJECT"); assert.equal(Number(row.bytes), object.bytes, "TARGET_OBJECT_SIZE_MISMATCH"); }
			counts.reusedUploadedObjects = existing.length; counts.objectsUploaded = existing.length;
			const existingKeys = new Set(existing.map(v => v.name));
			for (const [index, object] of manifest.objects.entries()) {
				activeOrdinal = index + 1; activeBytes = 0;
				const fingerprint = createHash("sha256").update(object.key).digest("hex");
				if (journal.verified[fingerprint]) { assert.ok(existingKeys.has(object.key), "VERIFIED_OBJECT_MISSING"); assert.ok(isDeepStrictEqual(journal.verified[fingerprint], { bytes: object.bytes, sha256: object.sha256 })); counts.objectsVerified++; continue; }
				if (!existingKeys.has(object.key)) {
					phase = "upload-remaining-object"; const bytes = await readFile(path.join(staging, object.file)); assert.equal(bytes.length, object.bytes);
					await uploadOrConfirm({ expectedBytes: object.bytes,
						write: () => api.storage.from(object.bucket).upload(object.key, bytes, { contentType: object.mime, upsert: false }),
						inspect: () => api.storage.from(object.bucket).info(object.key),
						onFailure: failure => console.log(JSON.stringify({ event: "upload_response_failure_inspect_before_retry", activeOrdinal, expectedBytes: object.bytes, ...failure })),
					}); counts.objectsUploaded++;
				}
				phase = "stream-object-readback";
				await streamObjectReadback({ endpoint, apiKey: secret, bucket: object.bucket, key: object.key, bytes: object.bytes, sha256: object.sha256, signal, onProgress: n => { activeBytes = n; } });
				journal.verified[fingerprint] = { bytes: object.bytes, sha256: object.sha256 }; await save(); counts.objectsVerified++;
				console.log(JSON.stringify({ phase, ...counts, activeOrdinal, fileBytes: object.bytes }));
			}
			assert.equal(counts.objectsVerified, 192);
			phase = "one-normal-password-login"; journal.loginAttempted = true; await save(); counts.loginAttempts++;
			const account = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8")).A;
			const auth = createClient(endpoint, publicKey, options); const login = await auth.auth.signInWithPassword(account);
			assert.equal(login.error, null, "RESTORED_PASSWORD_LOGIN_FAILED"); assert.ok(login.data.user && login.data.session);
			const who = await auth.auth.getUser(); assert.equal(who.error, null); assert.equal(who.data.user?.id, login.data.user.id);
			if (connectorMode) {
				phase = "anonymous-private-storage-denial";
				const sample = manifest.objects[0]; assert.ok(sample);
				const response = await fetch(`${endpoint}/storage/v1/object/authenticated/${sample.bucket}/${sample.key}`, { headers: { apikey: publicKey, Range: "bytes=0-0" }, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
				assert.ok([400, 401, 403, 404].includes(response.status), "ANONYMOUS_PRIVATE_STORAGE_NOT_DENIED");
				const denial = await response.json(); assert.match(JSON.stringify(denial), /not.?found|access.?denied|unauthori|permission/i, "UNEXPECTED_STORAGE_DENIAL_CODE");
				await writeFile(path.join(root, "authenticated-user.json"), JSON.stringify({ id: login.data.user.id, sourceSet, targetRef: target }), { flag: "wx", mode: 0o600 });
				const result = { checkedAt: new Date().toISOString(), status: "FILES_AND_AUTH_PASS_ROLE_CHECK_PENDING", targetRef: target, sourceSet, objects: 192, ...counts, allObjectReadbackHashesMatch: true, normalAuthLoginVerified: true, getUserVerified: true, anonymousStorageStatus: response.status, anonymousStorageDenied: true, nativePgConnectionClaim: "NOT_PASSED: local connect closed; ordinary-role SQL verification uses connected provider separately", sourceResumed: false };
				await writeFile("docs/evidence/p3-05/recovery-files-auth.json", `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" }); console.log(JSON.stringify(result)); return;
			}
			phase = "restored-owner-history-and-denials";
			const runtime = databaseClient(runtimeUrl, ca); runtime.on("error", () => {}); const stopRuntime = cancelDatabaseOnAbort(runtime, signal);
			let historyRows = 0, deliveryRows = 0;
			try {
				await runtime.connect(); await query(runtime, "begin read only"); await query(runtime, "select set_config('pm.owner_id',$1,true)", [login.data.user.id]);
				const expectedProjects = (await query(db, "select id from pm.projects where owner_id=$1 order by id", [login.data.user.id])).rows; assert.ok(expectedProjects.length > 0);
				assert.deepEqual((await query(runtime, "select id from pm.projects order by id")).rows, expectedProjects);
				for (const table of ["annotation_revisions", "deliveries"]) {
					const adminCount: number = (await query(db, `select count(*)::int as n from pm.${recoveryIdentifier(table)} r join pm.projects p on p.id=r.project_id where p.owner_id=$1`, [login.data.user.id])).rows[0]?.n;
					const visible: number = (await query(runtime, `select count(*)::int as n from pm.${recoveryIdentifier(table)}`)).rows[0]?.n; assert.equal(visible, adminCount); assert.ok(visible > 0);
					if (table === "annotation_revisions") historyRows = visible; else deliveryRows = visible;
				}
				const other = (await query(db, "select id from auth.users where id<>$1 order by id limit 1", [login.data.user.id])).rows[0]; assert.ok(other);
				await query(runtime, "select set_config('pm.owner_id',$1,true)", [other.id]); assert.equal((await query(runtime, "select id from pm.projects where id=$1", [expectedProjects[0]?.id])).rowCount, 0);
				await query(runtime, "select set_config('pm.owner_id','',true)"); assert.equal((await query(runtime, "select id from pm.projects")).rowCount, 0);
				const old = (await query(db, "select token_hash,project_id from pm.guest_sessions order by id limit 1")).rows[0]; assert.ok(old);
				await query(runtime, "select set_config('pm.guest_hash',$1,true)", [old.token_hash]); assert.equal((await query(runtime, "select id from pm.projects where id=$1", [old.project_id])).rowCount, 0);
				await query(runtime, "rollback");
			} finally { stopRuntime(); await runtime.end().catch(() => {}); }
			const closure = (await query(db, "select count(*)::int as objects from storage.objects where bucket_id='partmeasure-private'")).rows[0]; assert.equal(closure.objects, 192);
			const result = { checkedAt: new Date().toISOString(), status: "TARGET_RESTORE_PASS_SOURCE_RESUME_STILL_REQUIRED", targetRef: target, sourceSet, tables: 24,
				tableFingerprintsBeforeInvalidationMatch: true, resumedUnchangedTableHashesVerified: 20, resumedAllTableCountsVerified: 24, objects: 192, ...counts,
				allObjectReadbackHashesMatch: true, authUsers: 5, identities: 5, oldAuthSessionsAndClaimsImported: false, oldAuthTokensCleared: true, oldIdempotencyReplayInvalidated: true,
				normalAuthLoginVerified: true, ownerRuntimeAndCrossOwnerDenialVerified: true, anonymousAndOldGuestContextsDenied: true, historyRows, deliveryRows, sourceResumed: false, productionReleased: false };
			await writeFile("docs/evidence/p3-05/recovery-cloud-target.json", `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" }); console.log(JSON.stringify(result));
		});
	} finally { key.fill(0); stop(); if (connected) await db.query("rollback").catch(() => {}); await db.end().catch(() => {}); }
}
main().finally(() => clearInterval(progress)).catch(async error => {
	const e = error as { name?: string; code?: string; message?: string; cause?: { code?: string } }; const first = e.message?.split(/\r?\n/, 1)[0] ?? "";
	const diagnostic = /connection.*(?:terminat|closed)/i.test(first) ? "CONNECTION_CLOSED" : /timeout|timed out/i.test(first) ? "CONNECTION_TIMEOUT" : /SASL|SCRAM/i.test(first) ? "SASL_HANDSHAKE_ERROR" : /certificate|SSL|TLS/i.test(first) ? "TLS_ERROR" : undefined;
	const result = { checkedAt: new Date().toISOString(), status: "INCOMPLETE_SOURCE_RESUME_REQUIRED_IF_EXTERNAL_BLOCK", phase, ...counts, activeOrdinal, activeBytes,
		name: e.name, code: e.code, causeCode: e.cause?.code, diagnostic, storage: (error as { storage?: unknown }).storage, inspection: (error as { inspection?: unknown }).inspection, errorMessageHash: createHash("sha256").update(e.message ?? "").digest("hex"), reason: /^[A-Z][A-Z0-9_]+$/.test(first) ? first : "REDACTED_TECHNICAL_ERROR" };
	console.error(JSON.stringify(result)); await writeFile("docs/evidence/p3-05/recovery-cloud-finish-failure.json", `${JSON.stringify(result, null, 2)}\n`); process.exitCode = 1;
});
