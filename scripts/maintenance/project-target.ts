import { AppError } from "../../src/lib/policy";

export const labProjectRef = "rvysclscetfqicpnzlra";
// Exact fresh target created under the 2026-10-29 approved production scope.
export const productionProjectRef = "qjiifweyhahowjdluqys";
export type MaintenanceProjectRef = typeof labProjectRef | typeof productionProjectRef;

/** Default remains lab-only; environment variables cannot introduce arbitrary targets. */
export function maintenanceProject(env: Record<string, string | undefined>): MaintenanceProjectRef {
	if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new AppError("TLS_DOWNGRADE_REFUSED");
	const profile = env.PM_MAINTENANCE_PROFILE ?? "lab";
	if (profile === "lab" && env.VERCEL_ENV !== "production") return labProjectRef;
	if (profile === "production" && !env.VERCEL) return productionProjectRef;
	throw new AppError("UNAPPROVED_MAINTENANCE_PROFILE");
}
