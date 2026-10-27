import { AppError } from "../../src/lib/policy";

/** These one-shot tools only operate against the explicitly approved lab. */
export function maintenanceTarget(env: Record<string, string | undefined>) {
	const ref = "rvysclscetfqicpnzlra";
	const provider = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid");
	const database = new URL(env.WORKER_DATABASE_URL ?? "http://invalid");
	if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new AppError("TLS_DOWNGRADE_REFUSED");
	if (env.VERCEL_ENV === "production" ||
		provider.href !== `https://${ref}.supabase.co/` ||
		!["postgres:", "postgresql:"].includes(database.protocol) ||
		decodeURIComponent(database.username) !== `partmeasure_worker.${ref}` ||
		!/^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(database.hostname) ||
		!["5432", "6543"].includes(database.port) || database.pathname !== "/postgres" ||
		!database.password || database.hash ||
		[...database.searchParams.keys()].some(key => key !== "sslmode") ||
		(database.searchParams.has("sslmode") && !["require", "verify-ca", "verify-full"].includes(database.searchParams.get("sslmode") ?? "")))
		throw new AppError("ISOLATED_MAINTENANCE_ONLY");
}
