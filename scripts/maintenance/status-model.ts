import { z } from "zod";

const count = z.number().int().nonnegative().safe();
const bytes = z.string().regex(/^\d+$/);
export const statusSnapshot = z.object({
	pending: count, expired_processing: count, cleanup_due: count, cleanup_eligible: count,
	cleanup_needs_operator: count, oldest_pending_seconds: count, oldest_cleanup_overdue_seconds: count,
	reserved_bytes: bytes, used_bytes: bytes, largest_account_bytes: bytes,
}).strict();
export type StatusSnapshot = z.infer<typeof statusSnapshot>;
export function assessStatus(input: unknown) {
	const data = statusSnapshot.parse(input);
	const alerts: { code: string; severity: "warning" | "critical" }[] = [];
	if (data.expired_processing) alerts.push({ code: "UPLOAD_PROCESSING_EXPIRED", severity: "warning" });
	if (data.pending && data.oldest_pending_seconds >= 7200) alerts.push({ code: "UPLOAD_PENDING_2H", severity: "warning" });
	if (data.cleanup_needs_operator) alerts.push({ code: "CLEANUP_OPERATOR_REQUIRED", severity: "critical" });
	if (data.cleanup_eligible) alerts.push({ code: "CLEANUP_READY", severity: "warning" });
	if (data.cleanup_eligible && (data.cleanup_eligible >= 100 || data.oldest_cleanup_overdue_seconds >= 86400))
		alerts.push({ code: "CLEANUP_BACKLOG", severity: "critical" });
	// This is the application's per-account budget, not provider disk/egress usage.
	const capacity = 5n * 1024n ** 3n, largest = BigInt(data.largest_account_bytes);
	if (largest * 100n >= capacity * 95n) alerts.push({ code: "APP_ACCOUNT_CAPACITY_95", severity: "critical" });
	else if (largest * 100n >= capacity * 80n) alerts.push({ code: "APP_ACCOUNT_CAPACITY_80", severity: "warning" });
	const status: "ok" | "warning" | "critical" = alerts.some(a => a.severity === "critical") ? "critical" : alerts.length ? "warning" : "ok";
	return { data, alerts, status };
}

export const statusRecord = z.object({
	version: z.literal(1), checkedAt: z.iso.datetime(),
	status: z.enum(["ok", "warning", "critical", "unknown"]),
	alerts: z.array(z.enum(["UPLOAD_PROCESSING_EXPIRED", "UPLOAD_PENDING_2H", "CLEANUP_OPERATOR_REQUIRED", "CLEANUP_READY", "CLEANUP_BACKLOG", "APP_ACCOUNT_CAPACITY_95", "APP_ACCOUNT_CAPACITY_80", "MAINTENANCE_DEPENDENCY_UNAVAILABLE"])).max(20),
}).strict();
export function statusTransition(previous: unknown, current: z.infer<typeof statusRecord>) {
	const parsed = statusRecord.safeParse(previous);
	// An unknown dependency result can raise an alert, but never clears earlier problems.
	const old = parsed.success ? parsed.data.alerts : [];
	const active = current.status === "unknown" ? [...new Set([...old, ...current.alerts])] : current.alerts;
	return { record: { ...current, alerts: active }, raised: active.filter(code => !old.includes(code)), cleared: old.filter(code => !active.includes(code)) };
}
