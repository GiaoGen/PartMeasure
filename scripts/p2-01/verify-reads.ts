// Existing isolated test records only. No browser, deployment or business writes.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { listDeliveries, listDeliveryHistory, getDelivery } from "../../src/lib/server/delivery-service";
import { getPool, type Actor } from "../../src/lib/server/db";
import { cursorScope, queryCursor } from "../../src/lib/server/query-cursor";

const ref = "rvysclscetfqicpnzlra";
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid").hostname !== `${ref}.supabase.co`
	|| !decodeURIComponent(new URL(process.env.DATABASE_URL ?? "http://invalid").username).endsWith(`.${ref}`)
	|| process.env.PM_NETWORK_MODE !== "direct") throw Error("ISOLATED_DIRECT_ONLY");
const results: { name: string; status: string; count?: number; code?: string }[] = [];
let step = "load_existing_fixture";
try {
	const fixture = JSON.parse(await readFile("tmp/p0-4/fixture.json", "utf8"));
	const accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
	async function login(account: { email: string; password: string }): Promise<Extract<Actor, { kind: "owner" }>> {
		const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } });
		const result = await client.auth.signInWithPassword(account);
		if (result.error) throw Object.assign(new Error("TEST_ACCOUNT_LOGIN_FAILED"), { code: result.error.code ?? result.error.name });
		assert.ok(result.data.user?.email_confirmed_at);
		return { kind: "owner", id: result.data.user.id };
	}
	step = "login_A";
	const ownerA = await login(accounts.A);
	step = "login_B";
	const ownerB = await login(accounts.B);
	step = "read_current_and_history";
	const current = await listDeliveries(ownerA, fixture.projectA);
	assert.ok(current.published?.versionNo);
	const latest = current.published;
	const history = await listDeliveryHistory(ownerA, fixture.projectA, latest.versionNo as number, null);
	assert.ok(history.items.length > 0, "EXISTING_HISTORY_REQUIRED");
	assert.ok(history.items.length <= 10);
	assert.ok(history.items.every(item => item.state === "published" && (item.versionNo as number) < (latest.versionNo as number) && !("files" in item)));
	for (const item of history.items.slice(0, 2)) {
		const detail = await getDelivery(ownerA, fixture.projectA, item.id);
		assert.equal(detail.files.length, item.fileCount);
		assert.equal(detail.description, item.description);
		assert.equal(detail.versionNo, item.versionNo);
	}
	results.push({ name: "runtime_owner_history_matches_immutable_details", status: "PASS", count: history.items.length });
	step = "read_cursor_page";
	const first = history.items[0];
	assert.ok(first);
	const scope = cursorScope(["delivery-history-v1", `owner:${ownerA.id}`, fixture.projectA, latest.versionNo]);
	const continued = await listDeliveryHistory(ownerA, fixture.projectA, latest.versionNo as number, queryCursor(first.id, scope));
	assert.ok(continued.items.every(item => (item.versionNo as number) < (first.versionNo as number)));
	results.push({ name: "real_cursor_anchor_orders_older_versions", status: "PASS" });
	step = "deny_cross_project_reads";
	await assert.rejects(() => listDeliveryHistory(ownerB, fixture.projectA, latest.versionNo as number, null), { code: "NOT_FOUND" });
	await assert.rejects(() => getDelivery(ownerB, fixture.projectA, first.id), { code: "NOT_FOUND" });
	await assert.rejects(() => getDelivery(ownerA, fixture.projectB, first.id), { code: "NOT_FOUND" });
	results.push({ name: "owner_B_and_cross_project_detail_denied", status: "PASS" });
	step = "deny_invalid_guest";
	await assert.rejects(() => listDeliveryHistory({ kind: "guest", hash: "0".repeat(64) }, fixture.projectA, latest.versionNo as number, null), { code: "LINK_UNAVAILABLE" });
	results.push({ name: "invalid_guest_session_cannot_read_history", status: "PASS" });
} catch (error) {
	const candidate = (error as { code?: string }).code ?? "ASSERTION_OR_DEPENDENCY";
	results.push({ name: step, status: "FAIL", code: /^[A-Za-z0-9_]{2,50}$/.test(candidate) ? candidate : "DEPENDENCY" });
	process.exitCode = 1;
} finally {
	await getPool().end();
	const report = { checkedAt: new Date().toISOString(), projectRef: ref, scope: "Fresh existing A/B account login; actual restricted-runtime DAL reads on existing records. No business mutations, schema changes, browser, HTTP/UI acceptance, valid Guest positive path or network/mobile acceptance.", results };
	await mkdir("docs/evidence/p2-01", { recursive: true });
	await writeFile("docs/evidence/p2-01/reads.json", `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report));
}
