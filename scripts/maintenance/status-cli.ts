import nextEnv from "@next/env";
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { transaction, getPool } from "../../src/lib/server/db";
import { uploadCleanupEligible } from "../../src/lib/server/upload-cleanup";
import { maintenanceTarget } from "./target";
import { assessStatus, statusRecord, statusTransition } from "./status-model";
import { privateDirectory } from "./private-directory";
import { connectionFailure } from "./connection-model";

const args = process.argv.slice(2);
const record = args.includes("--record");
let phase = "arguments";
async function saveStatus(status: "ok" | "warning" | "critical" | "unknown", alerts: string[]) {
	if (!record) return;
	await mkdir("tmp", { recursive: true });
	try { await privateDirectory("tmp/maintenance-status"); }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
	const path = "tmp/maintenance-status/last.json";
	let previous: unknown;
	try { previous = JSON.parse(await readFile(path, "utf8")); }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	const current = statusRecord.parse({ version: 1, checkedAt: new Date().toISOString(), status, alerts });
	const transition = statusTransition(previous, current);
	const staging = `tmp/maintenance-status/${randomUUID()}.json`;
	await writeFile(staging, `${JSON.stringify(transition.record)}\n`, { mode: 0o600, flag: "wx" });
	await rename(staging, path);
	console.log(JSON.stringify({ event: "maintenance_transition", raised: transition.raised, cleared: transition.cleared, notification: "local-output-only" }));
}
async function main() {
	nextEnv.loadEnvConfig(process.cwd());
	if (new Set(args).size !== args.length || args.some(arg => !["--database", "--record"].includes(arg)) || (record && !args.includes("--database"))) throw Error("INVALID_ARGUMENTS");
	const required = ["APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL", "EVENT_DATABASE_URL"];
	const presence = Object.fromEntries(required.map(name => [name, Boolean(process.env[name]?.trim())]));
	const ca = Boolean(process.env.DATABASE_CA_PEM?.trim() || process.env.DATABASE_CA_FILE?.trim());
	console.log(JSON.stringify({ event: "runtime_configuration", nodeMajor: Number(process.versions.node.split(".")[0]), presence, verifiedTLSConfigured: ca,
		maintenanceConfigured: Boolean(process.env.WORKER_DATABASE_URL), uploadPolicy: "format-only-v2", workerRequired: false, liveDependenciesProbed: false }));
	if (!args.length) return;
	phase = "configuration";
	maintenanceTarget(process.env);
	phase = "database";
	const snapshot = await transaction(null, async db => {
		await db.query("set transaction read only");
		return (await db.query(`select
	 (select count(*)::int from pm.upload_reservations where state in ('reserved','queued','processing')) as pending,
	 (select count(*)::int from pm.upload_reservations where state='processing' and (processing_until is null or processing_until<now())) as expired_processing,
	 (select count(*)::int from pm.upload_reservations where cleanup_after<now() and state<>'cleaned' and (state<>'ready' or quarantine_cleaned_at is null)) as cleanup_due,
	 (select count(*)::int from pm.upload_reservations r where ${uploadCleanupEligible}) as cleanup_eligible,
	 (select count(*)::int from pm.upload_reservations where cleanup_dead_at is not null and state<>'cleaned') as cleanup_needs_operator,
	 (select coalesce(floor(extract(epoch from now()-min(created_at))),0)::int from pm.upload_reservations where state in ('reserved','queued','processing')) as oldest_pending_seconds,
	 (select coalesce(floor(extract(epoch from now()-min(r.cleanup_after))),0)::int from pm.upload_reservations r where ${uploadCleanupEligible}) as oldest_cleanup_overdue_seconds,
	 (select coalesce(sum(reserved_bytes),0)::text from pm.owner_usage) as reserved_bytes,
	 (select coalesce(sum(used_bytes),0)::text from pm.owner_usage) as used_bytes,
	 (select coalesce(max(used_bytes+reserved_bytes),0)::text from pm.owner_usage) as largest_account_bytes`)).rows[0];
	}, true);
	const assessment = assessStatus(snapshot);
	console.log(JSON.stringify({ event: "maintenance_counts", checkedAt: new Date().toISOString(), ...assessment, readOnly: true, providerStorageAndEgressMeasured: false }));
	phase = "record";
	await saveStatus(assessment.status, assessment.alerts.map(alert => alert.code));
	if (assessment.alerts.length) process.exitCode = 2;
}
main().catch(async error => {
	console.error(JSON.stringify({ event: "maintenance_status_failed", phase, ...connectionFailure(error) })); process.exitCode = 1;
	if (args.includes("--database") && args.every(arg => ["--database", "--record"].includes(arg)))
		await saveStatus("unknown", ["MAINTENANCE_DEPENDENCY_UNAVAILABLE"]).catch(() => {});
}).finally(async () => { try { await getPool(true).end(); } catch { /* Optional pool not created. */ } });
