import "server-only";
import { randomUUID } from "node:crypto";
import { transaction } from "./db";
import { privateBucket, quarantine, storage } from "./storage";
import { AppError } from "../policy";
import { z } from "zod";

type Candidate = { id: string; project_id: string; owner_id: string; quarantine_key: string; state: string; reserved_bytes: string };
const workerTx = <T>(work: Parameters<typeof transaction<T>>[1]) => transaction(null, work, true);
// Two minutes beyond both request and legacy leases prevents racing an expired in-flight Storage request.
export const uploadCleanupEligible = `r.cleanup_after<now() and r.grant_expires_at<now()-interval '2 minutes'
 and (r.processing_until is null or r.processing_until<now()-interval '2 minutes')
 and r.cleanup_dead_at is null and (r.cleanup_lease_until is null or r.cleanup_lease_until<now())
 and not exists(select 1 from pm.jobs j where j.reservation_id=r.id and j.lease_until>now()-interval '2 minutes')
 and (r.state='ready' and r.quarantine_cleaned_at is null or r.state not in ('ready','cleaned')
 and not exists(select 1 from pm.file_assets f where f.reservation_id=r.id))`;
const eligible = uploadCleanupEligible;
export const cleanupScopeSchema = z.object({
	projectId: z.uuid(),
	reservationIds: z.array(z.uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length),
}).strict();
export type CleanupScope = z.infer<typeof cleanupScopeSchema>;

/** One bounded maintenance run. Default is inspection; no daemon and no public HTTP endpoint. */
export async function cleanupUploads(apply = false, limit = 20, signal = AbortSignal.timeout(120000), scopeInput?: CleanupScope) {
	if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new AppError("INVALID_INPUT", 422);
	const scope = scopeInput === undefined ? undefined : cleanupScopeSchema.parse(scopeInput);
	signal.throwIfAborted();
	const rows = await workerTx(async db => (await db.query<Candidate>(
		`select r.id,r.project_id,r.quarantine_key,r.state,r.reserved_bytes,p.owner_id from pm.upload_reservations r join pm.projects p on p.id=r.project_id where ${eligible}
		 and ($2::uuid is null or r.project_id=$2 and r.id=any($3::uuid[])) order by r.cleanup_after,r.id limit $1`,
		[limit, scope?.projectId ?? null, scope?.reservationIds ?? null],
	)).rows);
	const counts = { candidates: rows.length, readyDuplicates: rows.filter(r => r.state === "ready").length, cleaned: 0, skipped: 0, failed: 0, interrupted: signal.aborted };
	if (!apply) return counts;
	for (const candidate of rows) {
		if (signal.aborted) { counts.interrupted = true; break; }
		const fence = randomUUID();
		let claimed = false;
		try {
			const prefix = `${candidate.project_id}/${candidate.id}`;
			// Never pass a stored arbitrary object path to a destructive Storage operation.
			if (candidate.quarantine_key !== `${prefix}/source`) throw new AppError("UNSAFE_CLEANUP_PATH", 503);
			const claim = await workerTx(async db => {
				await db.query("select owner_id from pm.owner_usage where owner_id=$1 for update", [candidate.owner_id]);
				await db.query("select id from pm.projects where id=$1 for update", [candidate.project_id]);
				const current = (await db.query<Candidate>(`select r.id,r.state,r.reserved_bytes from pm.upload_reservations r where r.id=$1 and r.project_id=$2 and ${eligible} for update`, [candidate.id, candidate.project_id])).rows[0];
				if (!current) return null;
				await db.query(`update pm.upload_reservations set state=case when state='ready' then state else 'rejected' end,
				 cleanup_token=$2,cleanup_lease_until=now()+interval '5 minutes',cleanup_attempts=cleanup_attempts+1,
				 processing_token=null,processing_until=null where id=$1`, [candidate.id, fence]);
				return current;
			});
			if (!claim) { counts.skipped++; continue; }
			claimed = true;
			await removeVerified(quarantine, prefix, ["source"], signal);
			if (claim.state !== "ready") await removeVerified(privateBucket, prefix, ["source", "canonical.webp", "thumb-320.webp", "thumb-640.webp"], signal);
			signal.throwIfAborted();
			await workerTx(async db => {
				await db.query("select owner_id from pm.owner_usage where owner_id=$1 for update", [candidate.owner_id]);
				await db.query("select id from pm.projects where id=$1 for update", [candidate.project_id]);
				const settled = await db.query(`update pm.upload_reservations r set
				 state=case when state='ready' then state else 'cleaned' end,quarantine_cleaned_at=now(),cleanup_lease_until=null
				 where r.id=$1 and r.project_id=$2 and cleanup_token=$3 and cleanup_lease_until>now()
				 and (r.state='ready' or r.state='rejected' and not exists(select 1 from pm.file_assets f where f.reservation_id=r.id)) returning id`, [candidate.id, candidate.project_id, fence]);
				if (!settled.rowCount) throw new AppError("CLEANUP_LEASE_LOST", 409);
				if (claim.state !== "ready") await db.query("update pm.owner_usage set reserved_bytes=reserved_bytes-$2 where owner_id=$1", [candidate.owner_id, claim.reserved_bytes]);
			});
			counts.cleaned++;
		} catch {
			counts.failed++;
			if (claimed) await workerTx(db => db.query(`update pm.upload_reservations set
			 cleanup_lease_until=now()+interval '30 minutes',cleanup_dead_at=case when cleanup_attempts>=5 then now() else null end
			 where id=$1 and cleanup_token=$2`, [candidate.id, fence])).catch(() => {});
			// Keep quota reserved on any uncertainty; report counts only, never paths/tokens/credentials.
		}
	}
	counts.interrupted = signal.aborted;
	return counts;
}

async function removeVerified(bucket: string, prefix: string, names: string[], signal: AbortSignal) {
	signal.throwIfAborted();
	const client = storage(signal).from(bucket);
	const removed = await client.remove(names.map(name => `${prefix}/${name}`));
	if (removed.error) throw new AppError("STORAGE_UNAVAILABLE", 503);
	// Probe each exact key. A truncated directory listing cannot prove absence.
	const checks = await Promise.allSettled(names.map(name => client.info(`${prefix}/${name}`)));
	for (const result of checks) {
		if (result.status !== "fulfilled" || !result.value.error || String(result.value.error.statusCode) !== "404")
			throw new AppError("CLEANUP_NOT_VERIFIED", 503);
	}
}
