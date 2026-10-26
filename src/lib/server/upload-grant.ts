import "server-only";
import type { Actor } from "./db";
import { transaction } from "./db";
import { access, actorKey } from "./service";
import { quarantine, storage, uploadGrant } from "./storage";
import { AppError } from "../policy";

export async function grantUpload(actor: Actor, projectId: string, id: string, signal: AbortSignal) {
	async function inspect(issued = false) {
		return transaction(actor, async db => {
			await access(db, actor, projectId);
			const row = (await db.query<{ state: string; actor_key: string; quarantine_key: string; expired: boolean }>(
				"select state,actor_key,quarantine_key,created_at<=now()-interval '15 minutes' as expired from pm.upload_reservations where project_id=$1 and id=$2 for update", [projectId, id],
			)).rows[0];
			if (!row || row.actor_key !== actorKey(actor)) throw new AppError("NOT_FOUND", 404);
			if (row.state === "reserved" && row.expired) throw new AppError("UPLOAD_WINDOW_EXPIRED", 409);
			if (issued && row.state !== "reserved") throw new AppError("INVALID_STATE", 409);
			if (issued) await db.query(
				"update pm.upload_reservations set grant_expires_at=now()+interval '2 hours',cleanup_after=now()+interval '27 hours' where project_id=$1 and id=$2", [projectId, id],
			);
			return row;
		});
	}
	signal.throwIfAborted();
	const row = await inspect();
	if (row.state !== "reserved") return { state: row.state };
	const existing = await storage(signal).from(quarantine).info(row.quarantine_key);
	signal.throwIfAborted();
	if (!existing.error && existing.data) {
		const current = await inspect();
		return { state: current.state === "reserved" ? "uploaded" : current.state };
	}
	if (!existing.error || !["404", "NoSuchKey"].includes(String(existing.error.statusCode)))
		throw new AppError("STORAGE_UNAVAILABLE", 503);
	const grant = await uploadGrant(row.quarantine_key, signal);
	// Signing cannot be part of a retryable SQL transaction. Recheck after it;
	// a revoked link, archive or newer attempt must not receive a late grant.
	await inspect(true);
	signal.throwIfAborted();
	return { ...grant, bucket: quarantine, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL };
}
