// Small existing isolated-data comparison. No browser and no business writes.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { inboxPage, currentIssues } from "../../src/lib/server/interaction-reads";
import { listIssues } from "../../src/lib/server/issue-service";
import { getPool, type Actor } from "../../src/lib/server/db";
import { unpackInbox } from "../../src/lib/issue-inbox";
import { withRequestTiming } from "../../src/lib/server/timing";
const ref = "rvysclscetfqicpnzlra";
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid").hostname !== `${ref}.supabase.co` || !decodeURIComponent(new URL(process.env.DATABASE_URL ?? "http://invalid").username).endsWith(`.${ref}`) || process.env.PM_NETWORK_MODE !== "direct") throw Error("ISOLATED_DIRECT_ONLY");
process.env.PM_SERVER_TIMING = "1";
const results: object[] = [];
async function sample<T>(name: string, work: () => Promise<T>) {
	let value: T | undefined;
	const start = performance.now();
	const response = await withRequestTiming(async () => { value = await work(); return Response.json({ data: value }); });
	results.push({ name, ms: Math.round(performance.now() - start), bytes: (await response.arrayBuffer()).byteLength, timing: response.headers.get("server-timing"), status: "PASS" });
	return value as T;
}
try {
	const fixture = JSON.parse(await readFile("tmp/annotation-collaboration/fixture.json", "utf8"));
	const account = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8")).A;
	const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } });
	const login = await auth.auth.signInWithPassword(account);
	assert.ok(login.data.user?.email_confirmed_at); assert.equal(login.error, null);
	const actor: Actor = { kind: "owner", id: login.data.user.id };
	const before = await sample("summary_then_individual_current_reads", async () => {
		const list = await listIssues(actor, fixture.projectId, null);
		const selected = list.items.filter(item => !item.closedAt).slice(0, 5);
		assert.ok(selected.length);
		const views = [];
		for (const item of selected) views.push((await currentIssues(actor, fixture.projectId, [item.id])).items[0]);
		return { list, views };
	});
	const page = await sample("inbox_one_page_current_views", () => inboxPage(actor, fixture.projectId, null));
	const views = unpackInbox(page);
	for (const old of before.views) {
		assert.ok(old);
		const view = views.find(item => item.id === old.id); assert.ok(view);
		assert.deepEqual(view.target, old.target); assert.deepEqual(view.responses, old.responses); assert.deepEqual(view.reviews, old.reviews); assert.equal(view.revision, old.revision);
	}
	const small = await inboxPage(actor, fixture.projectId, null, null, 2);
	assert.equal(small.items.length, Math.min(2, views.length));
	if (small.nextCursor) { const next = await inboxPage(actor, fixture.projectId, small.nextCursor, null, 2); assert.ok(next.items.every(item => !small.items.some(old => old.id === item.id))); }
	results.push({ name: "same_fixed_snapshots_current_replies_and_cursor", count: views.length, status: "PASS" });
} catch (error) {
	results.push({ name: "isolated_read_comparison", status: "FAIL", code: /^[A-Z0-9_]{2,50}$/.test((error as { code?: string }).code ?? "") ? (error as { code: string }).code : "ASSERTION_OR_DEPENDENCY" }); process.exitCode = 1;
} finally {
	await getPool().end();
	const report = { checkedAt: new Date().toISOString(), projectRef: ref, scope: "Existing test data, DAL only; Auth/HTTP preflight excluded. No business writes, browser, UI acceptance or stress test.", results };
	await mkdir("docs/evidence/performance-inbox-batch", { recursive: true });
	await writeFile("docs/evidence/performance-inbox-batch/reads.json", `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report));
}
