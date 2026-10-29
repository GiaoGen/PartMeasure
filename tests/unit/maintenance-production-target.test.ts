import { expect, it } from "vitest";
import { labProjectRef, productionProjectRef, maintenanceProject } from "../../scripts/maintenance/project-target";
import { maintenanceTarget } from "../../scripts/maintenance/target";
import { sourceAllowed, restoreAllowed, manifestSchema } from "../../scripts/maintenance/backup-model";

const source = (ref: string) => new URL(`postgresql://postgres.${ref}:synthetic@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`);
const production = { PM_MAINTENANCE_PROFILE: "production", NEXT_PUBLIC_SUPABASE_URL: `https://${productionProjectRef}.supabase.co`, WORKER_DATABASE_URL: `postgresql://partmeasure_worker.${productionProjectRef}:synthetic@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres` };
it("keeps lab as the default and refuses production backups unless the exact ref is supplied explicitly", () => {
	expect(maintenanceProject({})).toBe(labProjectRef);
	expect(sourceAllowed(source(labProjectRef), false)).toBe(true);
	expect(sourceAllowed(source(productionProjectRef), false)).toBe(false);
	expect(sourceAllowed(source(productionProjectRef), false, productionProjectRef)).toBe(true);
	expect(sourceAllowed(source(labProjectRef), false, productionProjectRef)).toBe(false);
	expect(sourceAllowed(source("xuyghznbcahlauontcyq"), false, productionProjectRef)).toBe(false);
});
it("requires matching role, provider, profile, verified transport and local operator context", () => {
	expect(() => maintenanceTarget(production)).not.toThrow();
	for (const patch of [{ PM_MAINTENANCE_PROFILE: "lab" }, { PM_MAINTENANCE_PROFILE: "any" }, { NEXT_PUBLIC_SUPABASE_URL: `https://${labProjectRef}.supabase.co` },
		{ WORKER_DATABASE_URL: production.WORKER_DATABASE_URL.replace("partmeasure_worker", "postgres") },
		{ WORKER_DATABASE_URL: `${production.WORKER_DATABASE_URL}?sslmode=disable` }, { NODE_TLS_REJECT_UNAUTHORIZED: "0" }, { VERCEL: "1" }])
		expect(() => maintenanceTarget({ ...production, ...patch })).toThrow();
	expect(() => maintenanceProject({ VERCEL_ENV: "production" })).toThrow();
});
it("does not turn the new production backup source into an allowed cloud restore destination", () => {
	expect(restoreAllowed(source(productionProjectRef))).toBe(false);
	expect(restoreAllowed(new URL("postgresql://postgres@127.0.0.1:55448/pm_restore_aabbccddeeff"))).toBe(true);
	expect(sourceAllowed(new URL("postgresql://postgres@127.0.0.1:55448/postgres"), true, productionProjectRef)).toBe(false);
});
it("accepts the exact production manifest/manual policy but refuses relabeling lab or another project's backup", () => {
	const fp = { bytes: 1, sha256: "a".repeat(64) };
	const value = { schemaVersion: 1, source: "production-supabase", projectRef: productionProjectRef, createdAt: "2026-10-29T00:00:00.000Z", serverVersion: "17.11",
		database: { ...fp, file: "000001.pmb", name: "database" }, objects: [], migrations: [{ ...fp, file: "000002.pmb", name: "migration/20261016104229_fixture.sql", migration: "20261016104229_fixture.sql" }], tables: {},
		coverage: { database: "pm+auth+available-migration-history", objects: "referenced-private-objects-including-hidden-and-history", authSessions: "excluded-and-invalidated", quarantine: "not-included-pending-uploads-rejected-on-restore", secrets: "external-vault-not-included", configuration: "manual-provider-and-SMTP-checklist-required", retention: "operator-managed-manual-prechange-or-important-data", consistency: "shared-database-snapshot+immutable-private-object-hashes" } };
	expect(manifestSchema.safeParse(value).success).toBe(true);
	for (const patch of [{ source: "isolated-supabase" }, { source: "disposable-native-fixture" }, { projectRef: labProjectRef }, { projectRef: "xuyghznbcahlauontcyq" }])
		expect(manifestSchema.safeParse({ ...value, ...patch }).success).toBe(false);
});
