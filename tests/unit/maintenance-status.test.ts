import { expect, it } from "vitest";
import { assessStatus, statusTransition } from "../../scripts/maintenance/status-model";
import { maintenanceTarget } from "../../scripts/maintenance/target";

const healthy = { pending: 0, expired_processing: 0, cleanup_due: 0, cleanup_eligible: 0, cleanup_needs_operator: 0,
	oldest_pending_seconds: 0, oldest_cleanup_overdue_seconds: 0, reserved_bytes: "0", used_bytes: "0", largest_account_bytes: "0" };
const record = (status: "ok" | "warning" | "critical" | "unknown", alerts: string[]) => ({ version: 1, checkedAt: "2026-10-27T00:00:00.000Z", status, alerts });
it("does not mistake missing/invalid counts for a healthy empty queue", () => {
	expect(assessStatus(healthy).status).toBe("ok");
	for (const value of [undefined, {}, { ...healthy, pending: -1 }, { ...healthy, largest_account_bytes: "NaN" }])
		expect(() => assessStatus(value)).toThrow();
});
it("distinguishes scheduled cleanup from safe eligibility and operator/deadline alerts", () => {
	expect(assessStatus({ ...healthy, cleanup_due: 5 }).alerts).toEqual([]);
	expect(assessStatus({ ...healthy, cleanup_eligible: 1 }).status).toBe("warning");
	const result = assessStatus({ ...healthy, pending: 1, expired_processing: 1, oldest_pending_seconds: 7200,
		cleanup_eligible: 1, oldest_cleanup_overdue_seconds: 86400, cleanup_needs_operator: 1 });
	expect(result.status).toBe("critical");
	expect(result.alerts.map(alert => alert.code)).toEqual(expect.arrayContaining(["UPLOAD_PROCESSING_EXPIRED", "UPLOAD_PENDING_2H", "CLEANUP_OPERATOR_REQUIRED", "CLEANUP_BACKLOG"]));
});
it("uses exact bigint application budgets without pretending to measure provider egress", () => {
	const capacity = 5n * 1024n ** 3n;
	expect(assessStatus({ ...healthy, largest_account_bytes: String(capacity * 8n / 10n) }).status).toBe("warning");
	expect(assessStatus({ ...healthy, largest_account_bytes: String(capacity * 95n / 100n) }).status).toBe("critical");
});
it("raises and clears alerts, and preserves the backlog through a dependency outage", () => {
	const previous = record("critical", ["CLEANUP_BACKLOG"]);
	const outage = statusTransition(previous, { version: 1, checkedAt: "2026-10-27T00:00:01.000Z", status: "unknown", alerts: ["MAINTENANCE_DEPENDENCY_UNAVAILABLE"] });
	expect(outage.cleared).toEqual([]);
	expect(outage.raised).toEqual(["MAINTENANCE_DEPENDENCY_UNAVAILABLE"]);
	expect(outage.record.alerts).toContain("CLEANUP_BACKLOG");
	const recovered = statusTransition(outage.record, { version: 1, checkedAt: "2026-10-27T00:00:02.000Z", status: "ok", alerts: [] });
	expect(recovered.cleared).toEqual(["CLEANUP_BACKLOG", "MAINTENANCE_DEPENDENCY_UNAVAILABLE"]);
});
it("refuses other providers, runtime/admin identities, malformed targets, production and TLS downgrades", () => {
	const env = { NEXT_PUBLIC_SUPABASE_URL: "https://rvysclscetfqicpnzlra.supabase.co", WORKER_DATABASE_URL: "postgresql://partmeasure_worker.rvysclscetfqicpnzlra:test@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres" };
	expect(() => maintenanceTarget(env)).not.toThrow();
	for (const patch of [{ NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" }, { VERCEL_ENV: "production" }, { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
		{ WORKER_DATABASE_URL: env.WORKER_DATABASE_URL.replace("partmeasure_worker", "partmeasure_runtime") },
		{ WORKER_DATABASE_URL: env.WORKER_DATABASE_URL.replace("postgresql:", "https:") },
		{ WORKER_DATABASE_URL: `${env.WORKER_DATABASE_URL}?sslmode=disable` },
		{ WORKER_DATABASE_URL: `${env.WORKER_DATABASE_URL}?host=other.example` },
		{ WORKER_DATABASE_URL: env.WORKER_DATABASE_URL.replace(":6543/", ":1234/") }])
		expect(() => maintenanceTarget({ ...env, ...patch })).toThrow();
});
