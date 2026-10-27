// Default is offline preparation. --apply requires the separately approved exact batch.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createProject, projectDetail, reserve, fileForRead } from "../../src/lib/server/service";
import { completeUpload } from "../../src/lib/server/complete-upload";
import { cleanupUploads, type CleanupScope } from "../../src/lib/server/upload-cleanup";
import { getPool, transaction, type Actor } from "../../src/lib/server/db";
import { privateBucket, quarantine, storage } from "../../src/lib/server/storage";
import { authFetch } from "../../src/lib/server/auth-fetch";
import { privateDirectory } from "../maintenance/private-directory";
import { maintenanceTarget } from "../maintenance/target";
import { connectionFailure, connectionTarget } from "../maintenance/connection-model";
import { once, type Journal } from "../fix-c/model";

type State = Journal & { run: string; source: string; complete: boolean };
const fingerprint = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");
const sourceFiles = ["scripts/fix-d/cleanup-check.ts", "scripts/fix-c/model.ts", "scripts/maintenance/target.ts", "scripts/maintenance/connection-model.ts", "scripts/maintenance/private-directory.ts",
	"src/lib/server/upload-cleanup.ts", "src/lib/server/db.ts", "src/lib/server/service.ts", "src/lib/server/complete-upload.ts", "src/lib/server/storage.ts", "src/lib/server/auth-fetch.ts", "package-lock.json"];
async function source() {
	const paths = [...sourceFiles, "package.json", "next.config.ts", "tsconfig.json"];
	async function walk(directory: string) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = `${directory}/${entry.name}`;
			if (entry.isDirectory()) await walk(path); else if (entry.isFile()) paths.push(path);
		}
	}
	await walk("src"); await walk("supabase/migrations");
	return fingerprint(JSON.stringify(await Promise.all([...new Set(paths)].sort().map(async path => ({ path, sha256: fingerprint(await readFile(path)) })))));
}
function sample(kind: string) { return Buffer.from(`ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('FIX-D synthetic ${kind}'),'2;1');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n`); }
let state: State | undefined, directory: string | undefined;
const results: { name: string; status: "PASS" }[] = [];
async function save() {
	assert.ok(directory && state);
	const staged = `${directory}/${randomUUID()}.json`;
	await writeFile(staged, JSON.stringify(state), { flag: "wx", mode: 0o600 });
	await rename(staged, `${directory}/state.json`);
}
async function operation<T>(name: string, request: unknown, work: (key: string) => Promise<T>) {
	assert.ok(state);
	return once(state, name, request, randomUUID, save, work);
}
const worker = <T>(work: Parameters<typeof transaction<T>>[1]) => transaction(null, work, true);
async function main() {
	const args = process.argv.slice(2), digest = await source();
	await mkdir("tmp/fix-d", { recursive: true }); await mkdir("docs/evidence/fix-d", { recursive: true });
	if (!args.length) {
		const run = randomUUID(); directory = `tmp/fix-d/${run}`; await privateDirectory(directory);
		state = { run, source: digest, complete: false, operations: {} }; await save();
		const storedBytes = 2 * (sample("ready").length + sample("orphan").length);
		assert.ok(storedBytes <= 1024);
		await writeFile(`docs/evidence/fix-d/${run}-plan.json`, `${JSON.stringify({ run, preparedAt: new Date().toISOString(), offlineOnly: true, sourceDigest: digest,
			projectCount: 1, reservations: 2, maximumStoredBytes: 1024, expectedStoredBytes: storedBytes,
			objects: "two quarantine sources and two private sources, including the ready copy created by normal completeUpload",
			uploadGrantsMinted: false, failure: "one exact DELETE locally returns 503 before reaching Storage; real DB reservation must stay charged",
			cleanup: "only the two new reservations; three synthetic objects removed, ready private source retained and hash checked",
			timestamps: "only these never-granted test reservations are made eligible; one failed fixture lease reset; no global timing policy change",
			noOldDataChanges: true, noBrowserMailDeployOrNetworkChange: true }, null, 2)}\n`);
		console.log(JSON.stringify({ run, offlineOnly: true, sourceDigest: digest, maximumStoredBytes: 1024 })); return;
	}
	assert.equal(args.length, 2); assert.ok(["--inspect", "--apply"].includes(args[0] as string));
	assert.match(args[1] as string, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
	directory = `tmp/fix-d/${args[1]}`; state = JSON.parse(await readFile(`${directory}/state.json`, "utf8")) as State;
	assert.equal(state.run, args[1]);
	if (args[0] === "--inspect") {
		console.log(JSON.stringify({ run: state.run, sourceMatches: digest === state.source, complete: state.complete,
			operations: Object.entries(state.operations).map(([name, op]) => ({ name, status: op.status })) })); return;
	}
	assert.equal(digest, state.source, "FIX_D_SOURCE_CHANGED");
	if (state.complete) { console.log(JSON.stringify({ run: state.run, alreadyComplete: true })); return; }
	nextEnv.loadEnvConfig(process.cwd(), true); maintenanceTarget(process.env); connectionTarget(process.env);
	const account = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8")).A;
	const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
		{ auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: authFetch } });
	const login = await auth.auth.signInWithPassword(account); assert.ok(!login.error && login.data.session);
	const identity = await auth.auth.getUser(login.data.session.access_token); assert.ok(!identity.error && identity.data.user?.email_confirmed_at);
	const actor: Actor & { kind: "owner" } = { kind: "owner", id: identity.data.user.id };
	const project = await operation("project", { name: `FIX-D-${state.run}` }, key => createProject(actor, { name: `FIX-D-${state?.run}`, description: "Dedicated maintenance synthetic batch; no share or mail" }, key));
	assert.equal((await projectDetail(actor, project.id)).name, `FIX-D-${state.run}`);
	const created: Record<string, { id: string }> = {};
	for (const kind of ["ready", "orphan"]) {
		const bytes = sample(kind), input = { filename: `fix-d-${kind}.step`, byteSize: bytes.length, declaredMime: "application/octet-stream", sha256: fingerprint(bytes) };
		const upload = await operation(`reserve-${kind}`, input, key => reserve(actor, project.id, input, key));
		assert.ok(!upload.duplicate); created[kind] = upload;
		const path = `${project.id}/${upload.id}/source`;
		await operation(`quarantine-${kind}`, { path, sha256: input.sha256 }, async () => {
			const result = await storage(AbortSignal.timeout(15000)).from(quarantine).upload(path, bytes, { upsert: false, contentType: "application/octet-stream" });
			assert.ok(!result.error); return { done: true };
		});
		if (kind === "ready") await operation("complete-ready", { id: upload.id }, () => completeUpload(actor, project.id, upload.id, AbortSignal.timeout(60000)));
		else await operation("private-orphan", { path, sha256: input.sha256 }, async () => {
			const result = await storage(AbortSignal.timeout(15000)).from(privateBucket).upload(path, bytes, { upsert: false }); assert.ok(!result.error); return { done: true };
		});
	}
	const ids = [created.ready?.id, created.orphan?.id]; assert.ok(ids.every(Boolean));
	const scope: CleanupScope = { projectId: project.id, reservationIds: ids as string[] };
	await writeFile(`${directory}/scope.json`, JSON.stringify(scope), { mode: 0o600 });
	await operation("test-only-expiry", scope, () => worker(async db => {
		const rows = await db.query("update pm.upload_reservations set grant_expires_at=now()-interval '3 minutes',cleanup_after=now()-interval '1 second' where project_id=$1 and id=any($2::uuid[]) and actor_key=$3 returning id", [project.id, ids, `owner:${actor.id}`]);
		assert.equal(rows.rowCount, 2); return { count: rows.rowCount };
	}));
	const charge = async () => worker(async db => (await db.query("select reserved_bytes::text from pm.owner_usage where owner_id=$1", [actor.id])).rows[0].reserved_bytes as string);
	const before = await operation("quota-before", {}, async () => ({ bytes: await charge() }));
	const orphan = created.orphan?.id as string;
	await operation("injected-failure", { id: orphan }, async () => {
		const originalFetch = globalThis.fetch; let injected = 0;
		globalThis.fetch = async (input, init) => {
			const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
			if (init?.method === "DELETE") {
				assert.equal(url.origin, `https://rvysclscetfqicpnzlra.supabase.co`);
				assert.equal(url.pathname, `/storage/v1/object/${quarantine}`);
				assert.deepEqual(JSON.parse(String(init.body)).prefixes, [`${project.id}/${orphan}/source`]);
				injected++; return Response.json({ message: "FIX_D_INJECTED_UNAVAILABLE", statusCode: "503" }, { status: 503 });
			}
			return originalFetch(input, init);
		};
		try {
			const result = await cleanupUploads(true, 20, AbortSignal.timeout(30000), { projectId: project.id, reservationIds: [orphan] });
			assert.equal(injected, 1); assert.equal(result.failed, 1); assert.equal(result.cleaned, 0);
			assert.equal(await charge(), before.bytes);
			return { ...result, injectedLocallyBeforeStorage: true, quotaUnchanged: true };
		} finally { globalThis.fetch = originalFetch; }
	});
	results.push({ name: "injected_failure_preserves_real_database_charge", status: "PASS" });
	await operation("release-test-only-failed-lease", { id: orphan }, () => worker(async db => {
		const result = await db.query("update pm.upload_reservations set cleanup_lease_until=null where id=$1 and project_id=$2 and cleanup_attempts=1 and state='rejected' returning id", [orphan, project.id]);
		assert.equal(result.rowCount, 1); return { count: 1 };
	}));
	const orphanCharge = await operation("orphan-charge", { id: orphan }, () => worker(async db => (await db.query("select reserved_bytes::text as bytes from pm.upload_reservations where id=$1 and project_id=$2", [orphan, project.id])).rows[0] as { bytes: string }));
	const cleaned = await operation("cleanup-two-only", scope, async () => {
		const result = await cleanupUploads(true, 20, AbortSignal.timeout(120000), scope);
		assert.equal(result.cleaned, 2); assert.equal(result.failed, 0); assert.equal(result.interrupted, false); return result;
	});
	assert.equal(BigInt(before.bytes)-BigInt(await charge()), BigInt(orphanCharge.bytes));
	results.push({ name: "exact_absence_before_quota_settlement_and_ready_preserved", status: "PASS" });
	const file = await fileForRead(actor, project.id, created.ready?.id as string);
	const download = await storage(AbortSignal.timeout(15000)).from(privateBucket).download(file.storage_key); assert.ok(download.data && !download.error);
	assert.equal(fingerprint(Buffer.from(await download.data.arrayBuffer())), fingerprint(sample("ready")));
	assert.equal(await source(), digest);
	state.complete = true; await save();
	await writeFile(`docs/evidence/fix-d/${state.run}-cleanup.json`, `${JSON.stringify({ run: state.run, checkedAt: new Date().toISOString(), sourceDigest: digest,
		scope: "Normal confirmed Owner Auth + real runtime service DAL; scoped maintenance-role DB + private Storage. Maintenance fixtures without issued upload grants; locally injected failure, not an observed provider outage. No browser or old-data cleanup.",
		results, cleanup: cleaned, readyPrivateHashVerified: true, quotaReleasedBytes: orphanCharge.bytes, projectRetained: true }, null, 2)}\n`);
	console.log(JSON.stringify({ run: state.run, complete: true, cleaned: cleaned.cleaned }));
}
main().catch(error => { console.error(JSON.stringify({ event: "fix_d_cleanup_check_failed", ...connectionFailure(error) })); process.exitCode = 1; })
	.finally(async () => { for (const worker of [false, true]) { try { await getPool(worker).end(); } catch { /* Optional. */ } } });
