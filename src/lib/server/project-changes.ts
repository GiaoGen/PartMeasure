import "server-only";
import { type Actor, transaction } from "./db";
import { access } from "./service";
import { eventCursor, eventSequence } from "./event-cursor";
import { AppError } from "../policy";
import type { ProjectChanges, ProjectEvent } from "../project-events";

export async function projectChanges(
	actor: Actor,
	project: string,
	cursor: string | null,
	send?: (changes: ProjectChanges) => void,
) {
	const sequence = eventSequence(actor, project, cursor);
	return transaction(actor, async (db) => {
		// Locks serialize permission revocation with authorization and enqueueing.
		await access(db, actor, project, false, true);
		const column = actor.kind === "owner" ? "owner_seq" : "guest_seq";
		const floor = actor.kind === "owner" ? "owner_floor" : "guest_floor";
		const { rows } = await db.query(
			`select c.${column}::text as latest,c.${floor}::text as floor,
			 coalesce((select jsonb_agg(e.v order by e.n) from (
			 select ${column} as n,jsonb_build_object('sequence',${column}::text,'kind',kind,'entityId',entity_id,'fileId',file_id,'revision',revision,'state',state) as v
			 from pm.project_events where project_id=$1 and ${column}>coalesce($2::bigint,c.${column}) order by ${column} limit 101
			 ) e),'[]'::jsonb) as events from pm.project_event_cursors c where project_id=$1`,
			[project, sequence],
		);
		const row = rows[0];
		if (!row) throw new AppError("NOT_FOUND", 404);
		if (sequence && BigInt(sequence) > BigInt(row.latest))
			throw new AppError("CURSOR_INVALID", 422);
		const reset =
			sequence === null || BigInt(sequence) < BigInt(row.floor) || row.events.length > 100;
		const result: ProjectChanges = {
			cursor: eventCursor(actor, project, row.latest),
			sequence: row.latest,
			reset,
			events: reset ? [] : (row.events as ProjectEvent[]),
		};
		// No payload is queued after a revocation can acquire the same project/link locks.
		send?.(result);
		return result;
	});
}
