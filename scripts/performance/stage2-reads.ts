// Small real-isolated-DB comparison; no browser, deployment, or business data writes.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getPool, digest, type Actor, transaction } from "../../src/lib/server/db";
import * as reads from "../../src/lib/server/interaction-reads";
import * as annotations from "../../src/lib/server/annotation-service";
import * as issues from "../../src/lib/server/issue-service";
import { bootstrap, files } from "../../src/lib/server/service";
import { withRequestTiming } from "../../src/lib/server/timing";
import type { IssueCurrent } from "../../src/lib/issues";

const ref = "rvysclscetfqicpnzlra";
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid").hostname !== `${ref}.supabase.co` || !decodeURIComponent(new URL(process.env.DATABASE_URL ?? "http://invalid").username).endsWith(`.${ref}`) || process.env.PM_NETWORK_MODE !== "direct") throw Error("ISOLATED_DIRECT_ONLY");
process.env.PM_SERVER_TIMING = "1";
const results: { name: string; status: string; ms: number; timing?: string; bytes?: number; count?: number; code?: string }[] = [];
async function sample<T>(name: string, work: () => Promise<T>): Promise<T> {
	let value: T | undefined;
	const start = performance.now();
	try {
		const response = await withRequestTiming(async () => { value = await work(); return Response.json({ data: value }); });
		results.push({ name, status: "PASS", ms: Math.round(performance.now() - start), timing: response.headers.get("server-timing") ?? "", bytes: (await response.arrayBuffer()).byteLength });
		return value as T;
	} catch (error) {
		results.push({ name, status: "FAIL", ms: Math.round(performance.now() - start), code: /^[A-Z0-9_]{2,50}$/.test((error as { code?: string }).code ?? "") ? (error as { code: string }).code : "ASSERTION_OR_DEPENDENCY" });
		throw Error("READ_SAMPLE_FAILED");
	}
}
try {
	const fixture = JSON.parse(await readFile("tmp/annotation-collaboration/fixture.json", "utf8"));
	const account = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8")).A;
	const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } });
	const login = await auth.auth.signInWithPassword(account);
	if (login.error || !login.data.user?.email_confirmed_at) throw Error("TEST_LOGIN_FAILED");
	const actor: Actor = { kind: "owner", id: login.data.user.id };
	const { projectId } = fixture as { projectId: string };
	const selected = (await issues.listIssues(actor, projectId, null)).items.find(i => i.kind === "measurement" && i.annotationRef && !i.closedAt && i.state !== "confirmed");
	const fileId: string = selected?.fileId ?? fixture.fileId;
	const annotationId: string = selected?.annotationRef?.id ?? fixture.annotationId;
	// Warm only the connection, then compare the same user/file with no client cache.
	await transaction(actor, db => db.query("select 1"));
	const previous = await sample("before_annotation_then_list_then_each_full_detail", async () => {
		const document = await annotations.annotations(actor, projectId, fileId);
		const list = await issues.listIssues(actor, projectId, null, fileId, annotationId);
		const details = [];
		for (const item of list.items) details.push(await issues.detailIssue(actor, projectId, item.id));
		return { document, details };
	});
	const aggregate = await sample("after_annotation_current_views_one_transaction", () => reads.fileInteraction(actor, projectId, fileId, annotationId, null, true));
	assert.deepEqual(aggregate.document, previous.document);
	assert.ok(previous.details.length, "Comparison needs at least one existing measurement issue");
	for (const full of previous.details) {
		const current = aggregate.issues.items.find(i => i.id === full.id);
		assert.ok(current);
		assert.equal(current.revision, full.revision);
		assert.equal(current.historyCount, full.responses.length + full.reviews.length);
		assert.deepEqual(current.responses.map(r => r.id), full.latestResponseId ? [full.latestResponseId] : []);
		assert.deepEqual(current.target, full.target);
		const batch: { items: IssueCurrent[] } = await sample("bounded_current_batch", () => reads.currentIssues(actor, projectId, [full.id]));
		assert.deepEqual(batch.items[0], current);
		const history = [];
		let cursor: string | null = null;
		do {
			const page = await reads.historyPage(actor, projectId, full.id, cursor);
			history.push(...page.items); cursor = page.nextCursor;
		} while (cursor);
		assert.deepEqual(new Set(history.map(e => e.record.id)), new Set([...full.responses, ...full.reviews].map(e => e.id)));
		results.push({ name: "complete_history_matches_legacy", status: "PASS", ms: 0, count: history.length });
	}
	const fileList = await files(actor, projectId, null);
	const imageIds = fileList.items.filter(f => f.mime === "image/webp").slice(0, 6).map(f => f.id);
	assert.ok(imageIds.length);
	const layers = await sample("visible_gallery_batch", () => reads.layers(actor, projectId, imageIds));
	assert.equal(layers.items.length, imageIds.length);
	await sample("foreign_owner_and_wrong_project_rejected", async () => {
		await assert.rejects(reads.layers({ kind: "owner", id: randomUUID() }, projectId, [fileId]), { code: "NOT_FOUND" });
		await assert.rejects(reads.currentIssues(actor, randomUUID(), [aggregate.issues.items[0]?.id ?? randomUUID()]), { code: "NOT_FOUND" });
		await assert.rejects(reads.layers(actor, projectId, [...imageIds, ...imageIds, ...imageIds, ...imageIds]), { code: "INVALID_INPUT" });
		return { denied: true };
	});
	if (fixture.shareUrl) {
		const raw = new URL(fixture.shareUrl).pathname.split("/").at(-1) as string;
		const session = await bootstrap(raw);
		const guest: Actor = { kind: "guest", hash: digest(session.secret) };
		await sample("guest_current_history_and_file_filter", async () => {
			const current = await reads.fileInteraction(guest, projectId, fileId, annotationId, null, true);
			assert.ok(current.document?.items.every(a => !a.deleted));
			assert.ok(current.issues.items.every(i => i.fileId === fileId));
			if (current.issues.items[0]) await reads.historyPage(guest, projectId, current.issues.items[0].id, null);
			await assert.rejects(reads.layers(guest, projectId, [randomUUID()]), { code: "NOT_FOUND" });
			await assert.rejects(reads.layers({ kind: "guest", hash: "0".repeat(64) }, projectId, [fileId]), { code: "LINK_UNAVAILABLE" });
			return { guestFiltered: true };
		});
	}
} catch {
	results.push({ name: "run_completed", status: "FAIL", ms: 0, code: "ASSERTION_OR_DEPENDENCY" });
	process.exitCode = 1;
} finally {
	await mkdir("docs/evidence/performance-stage2", { recursive: true });
	const report = { checkedAt: new Date().toISOString(), projectRef: ref, scope: "Real isolated runtime-role DAL; auth and HTTP preflight excluded from timing; ordinary test login and guest-session bootstrap only", browser: false, productionDeployment: false, results };
	await writeFile("docs/evidence/performance-stage2/reads.json", `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report));
	await getPool().end();
}
