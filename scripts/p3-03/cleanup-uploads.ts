// Explicit one-shot maintenance, never a continuously running upload worker.
import nextEnv from "@next/env";
import { cleanupUploads } from "../../src/lib/server/upload-cleanup";
import { getPool } from "../../src/lib/server/db";

try {
	nextEnv.loadEnvConfig(process.cwd());
	const ref = "rvysclscetfqicpnzlra";
	const args = process.argv.slice(2);
	const apply = args.includes("--apply");
	if (args.some(arg => !["--apply", "--dry-run"].includes(arg)) || args.includes("--dry-run") && apply) throw Error("INVALID_ARGUMENTS");
	const url = new URL(process.env.WORKER_DATABASE_URL ?? "http://invalid");
	const provider = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid");
	if (provider.hostname !== `${ref}.supabase.co` || decodeURIComponent(url.username) !== `partmeasure_worker.${ref}` ||
		!url.hostname.endsWith(".pooler.supabase.com") || process.env.VERCEL_ENV === "production") throw Error("ISOLATED_MAINTENANCE_ONLY");
	const result = await cleanupUploads(apply);
	console.log(JSON.stringify({ event: "upload_cleanup", mode: apply ? "apply" : "dry-run", ...result }));
	if (result.failed) process.exitCode = 1;
} catch {
	console.error("UPLOAD_CLEANUP_FAILED (details redacted)"); process.exitCode = 1;
} finally { try { await getPool(true).end(); } catch { /* Configuration failed before a pool was created. */ } }
