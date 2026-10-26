import { z } from "zod";

export const backupLimits = { objects: 20000, totalBytes: 8 * 1024 ** 3, databaseBytes: 1024 ** 3, objectBytes: 100 * 1024 ** 2, manifestBytes: 16 * 1024 ** 2, durationMs: 20 * 60 * 1000 };
const fingerprint = z.object({ bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const artifact = fingerprint.extend({ file: z.string().regex(/^\d{6}\.pmb$/), name: z.string().min(1).max(500) }).strict();
export const objectKey = z.string().regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/(?:source|canonical\.webp|thumb-(?:320|640)(?:-[a-f0-9]{64})?\.webp)$/);
export const manifestSchema = z.object({
	schemaVersion: z.literal(1), source: z.enum(["isolated-supabase", "disposable-native-fixture"]), projectRef: z.literal("rvysclscetfqicpnzlra"), createdAt: z.iso.datetime(), serverVersion: z.string().max(100),
	database: artifact,
	objects: z.array(artifact.extend({ key: objectKey, bucket: z.literal("partmeasure-private"), mime: z.string().max(120) })).max(backupLimits.objects),
	migrations: z.array(artifact.extend({ migration: z.string().regex(/^\d{14}_[a-z0-9_]+\.sql$/) })).min(1).max(1000),
	tables: z.record(z.string().regex(/^[a-z_]+$/), z.object({ rows: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
	coverage: z.object({ database: z.literal("pm+auth+available-migration-history"), objects: z.literal("referenced-private-objects-including-hidden-and-history"), authSessions: z.literal("excluded-and-invalidated"), quarantine: z.literal("not-included-pending-uploads-rejected-on-restore"), secrets: z.literal("external-vault-not-included"), configuration: z.literal("manual-provider-and-SMTP-checklist-required"), retention: z.literal("operator-managed-7-daily-4-weekly"), consistency: z.literal("shared-database-snapshot+immutable-private-object-hashes") }).strict(),
}).strict().superRefine((value, context) => {
	const entries = [value.database, ...value.objects, ...value.migrations];
	if (new Set(entries.map(e => e.file)).size !== entries.length || new Set(entries.map(e => e.name)).size !== entries.length ||
		new Set(value.objects.map(e => e.key)).size !== value.objects.length || entries.reduce((n, e) => n + e.bytes, 0) > backupLimits.totalBytes)
		context.addIssue({ code: "custom", message: "INVALID_BACKUP_INDEX" });
	if (value.database.bytes > backupLimits.databaseBytes || value.objects.some(e => e.bytes > backupLimits.objectBytes) || value.migrations.some(e => e.bytes > 4 * 1024 ** 2))
		context.addIssue({ code: "custom", message: "BACKUP_SIZE_LIMIT" });
});
export type BackupManifest = z.infer<typeof manifestSchema>;
export type ObjectReference = { key: string; bytes: number; sha256: string; mime: string };

export function sourceAllowed(url: URL, native: boolean) {
	if (native) return process.env.PM_EVENTS_LOCAL === "disposable-native-pg" && url.hostname === "127.0.0.1" && url.port === "55448" && url.username === "postgres";
	return decodeURIComponent(url.username) === "postgres.rvysclscetfqicpnzlra" && url.hostname.endsWith(".pooler.supabase.com") && url.port === "5432";
}
export function restoreAllowed(url: URL) {
	return url.hostname === "127.0.0.1" && url.port === "55448" && url.username === "postgres" && /^\/pm_restore_[a-f0-9]{12}$/.test(url.pathname);
}
