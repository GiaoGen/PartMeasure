import nextEnv from "@next/env";
import { transaction, getPool } from "../../src/lib/server/db";

async function main() {
	nextEnv.loadEnvConfig(process.cwd());
	const args = process.argv.slice(2);
	if (args.length > 1 || args.length && args[0] !== "--database") throw Error("INVALID_ARGUMENTS");
	const required = ["APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL", "EVENT_DATABASE_URL"];
	const presence = Object.fromEntries(required.map(name => [name, Boolean(process.env[name]?.trim())]));
	const ca = Boolean(process.env.DATABASE_CA_PEM?.trim() || process.env.DATABASE_CA_FILE?.trim());
	console.log(JSON.stringify({ event: "runtime_configuration", nodeMajor: Number(process.versions.node.split(".")[0]), presence, verifiedTLSConfigured: ca,
		maintenanceConfigured: Boolean(process.env.WORKER_DATABASE_URL), uploadPolicy: "format-only-v2", workerRequired: false, liveDependenciesProbed: false }));
	if (!args.length) return;
	const url = new URL(process.env.WORKER_DATABASE_URL ?? "http://invalid");
	if (decodeURIComponent(url.username) !== "partmeasure_worker.rvysclscetfqicpnzlra" || !url.hostname.endsWith(".pooler.supabase.com")) throw Error("ISOLATED_MAINTENANCE_ONLY");
	const result = await transaction(null, async db => (await db.query(`select
	 (select count(*)::int from pm.upload_reservations where state in ('reserved','queued','processing')) as pending,
	 (select count(*)::int from pm.upload_reservations where state='processing' and processing_until<now()) as expired_processing,
	 (select count(*)::int from pm.upload_reservations where cleanup_after<now() and state<>'cleaned' and (state<>'ready' or quarantine_cleaned_at is null)) as cleanup_due,
	 (select count(*)::int from pm.upload_reservations where cleanup_dead_at is not null) as cleanup_needs_operator,
	 (select coalesce(sum(reserved_bytes),0)::text from pm.owner_usage) as reserved_bytes`)).rows[0], true);
	console.log(JSON.stringify({ event: "maintenance_counts", data: result, readOnly: true }));
}
main().catch(() => { console.error("MAINTENANCE_STATUS_FAILED (details redacted)"); process.exitCode = 1; })
	.finally(async () => { try { await getPool(true).end(); } catch { /* Optional pool not created. */ } });
