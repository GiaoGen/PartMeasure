import "server-only";
import type { PoolClient } from "pg";
import type { DeliveryFeedback, FeedbackInput, FeedbackPage, Receipt } from "../delivery-feedback";
import { AppError } from "../policy";
import { type Actor, transaction, idempotent, rate } from "./db";
import { access, actorKey, audit } from "./service";
import { cursorScope, cursorId, queryCursor } from "./query-cursor";

async function published(db: PoolClient, projectId: string, deliveryId: string) {
	const { rows } = await db.query("select id from pm.deliveries where project_id=$1 and id=$2 and state='published'", [projectId, deliveryId]);
	if (!rows[0]) throw new AppError("NOT_FOUND", 404);
}
async function currentReceipt(db: PoolClient, projectId: string, deliveryId: string, sessionId: string) {
	const { rows } = await db.query<Receipt>(`with latest as (
	 select id,kind,created_at as "createdAt" from pm.delivery_feedback
	 where project_id=$1 and delivery_id=$2 and guest_session_id=$3 and kind in ('received','accepted') order by ordinal desc limit 1
	) select * from latest l where not exists(select 1 from pm.delivery_feedback w where w.project_id=$1 and w.delivery_id=$2 and w.target_id=l.id)`, [projectId, deliveryId, sessionId]);
	return rows[0] ?? null;
}
export async function listFeedback(actor: Actor, projectId: string, deliveryId: string, cursor: string | null): Promise<FeedbackPage> {
	const scope = cursorScope(["delivery-feedback-v1", actorKey(actor), projectId, deliveryId]);
	const anchor = cursorId(cursor, scope);
	return transaction(actor, async db => {
		const { sessionId } = await access(db, actor, projectId, false, true);
		await published(db, projectId, deliveryId);
		const { rows } = await db.query<Omit<FeedbackPage, "nextCursor"> & { anchorExists: boolean }>(`with records as materialized (
		 select * from pm.delivery_feedback where project_id=$1 and delivery_id=$2
		), latest as (
		 select distinct on (guest_session_id) * from records where kind in ('received','accepted') order by guest_session_id,ordinal desc
		), valid as (
		 select * from latest l where not exists(select 1 from records w where w.target_id=l.id)
		), anchor as (select ordinal from records where id=$3::uuid), page as (
		 select * from records where $3::uuid is null or ordinal<(select ordinal from anchor) order by ordinal desc limit 21
		)
		select coalesce((select jsonb_agg(jsonb_build_object(
		 'id',p.id,'kind',p.kind,'body',p.body,'guestLabel',p.guest_label,'authorType',p.author_type,'createdAt',p.created_at,'targetId',p.target_id,
		 'receiptState',case when p.kind not in ('received','accepted') then null
		 when exists(select 1 from records w where w.target_id=p.id) then 'withdrawn'
		 when exists(select 1 from valid v where v.id=p.id) then 'current' else 'superseded' end
		) order by p.ordinal desc) from page p),'[]'::jsonb) as items,
		(select count(*)::int from records) as total,
		jsonb_build_object('received',(select count(*)::int from valid where kind='received'),'accepted',(select count(*)::int from valid where kind='accepted')) as receipts,
		(select jsonb_build_object('id',id,'kind',kind,'createdAt',created_at) from valid where guest_session_id=$4::uuid) as "myReceipt",
		($3::uuid is null or exists(select 1 from anchor)) as "anchorExists"`, [projectId, deliveryId, anchor, sessionId]);
		const data = rows[0];
		if (!data?.anchorExists) throw new AppError("CURSOR_INVALID", 422);
		const last = data.items[19];
		return { items: data.items.slice(0, 20), total: data.total, receipts: data.receipts, myReceipt: data.myReceipt,
			nextCursor: data.items.length > 20 && last ? queryCursor(last.id, scope) : null };
	});
}
export async function addFeedback(actor: Actor, projectId: string, deliveryId: string, input: FeedbackInput, key: string) {
	if (actor.kind !== "guest") throw new AppError("FORBIDDEN", 403);
	return transaction(actor, async db => {
		const { sessionId } = await access(db, actor, projectId);
		if (!sessionId) throw new AppError("LINK_UNAVAILABLE", 401);
		await published(db, projectId, deliveryId);
		return idempotent(db, `${projectId}:${actorKey(actor)}:delivery-feedback`, key, { deliveryId, input }, async () => {
			await rate(db, `feedback:${projectId}:${actorKey(actor)}`, 20);
			const current = await currentReceipt(db, projectId, deliveryId, sessionId);
			if (input.kind === "withdrawn" && current?.id !== input.targetId)
				throw new AppError("FEEDBACK_STATE_CONFLICT", 409);
			if (input.kind === "received" && current || input.kind === "accepted" && current?.kind === "accepted")
				throw new AppError("FEEDBACK_STATE_CONFLICT", 409);
			if (input.kind !== "withdrawn") {
				const count = await db.query<{ n: number }>("select count(*)::int as n from pm.delivery_feedback where project_id=$1 and delivery_id=$2", [projectId, deliveryId]);
				if ((count.rows[0]?.n ?? 0) >= 1000) throw new AppError("FEEDBACK_LIMIT", 409);
			}
			const { rows } = await db.query<Pick<DeliveryFeedback, "id" | "kind" | "createdAt">>(`insert into pm.delivery_feedback(project_id,delivery_id,guest_session_id,kind,body,guest_label,target_id)
			 values($1,$2,$3,$4,$5,$6,$7) returning id,kind,created_at as "createdAt"`, [projectId, deliveryId, sessionId, input.kind, input.body, input.guestLabel, input.targetId ?? null]);
			await audit(db, actor, projectId, `delivery.feedback.${input.kind}`, rows[0]?.id as string);
			return rows[0];
		});
	});
}
