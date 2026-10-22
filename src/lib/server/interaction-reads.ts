import "server-only";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { IssueCurrent, IssueCurrentPage, IssueHistoryPage } from "../issues";
import { AppError } from "../policy";
import { type Actor, transaction } from "./db";
import { access, actorKey } from "./service";
import { annotationDocuments } from "./annotation-service";
import { issueColumns } from "./issue-service";
import { cursorScope, cursorId, queryCursor } from "./query-cursor";
import { packInbox } from "../issue-inbox";

export const batchIds = z.array(z.uuid()).min(1).max(6).refine(ids => new Set(ids).size === ids.length);
export const inboxIds = z.array(z.uuid()).min(1).max(30).refine(ids => new Set(ids).size === ids.length);
/** Protect both server serialization and the bounded client cache. */
function budget<T>(value: T): T {
	if (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024)
		throw new AppError("READ_BATCH_TOO_LARGE", 413);
	return value;
}
function checkedIds(ids: string[]) {
	const parsed = batchIds.safeParse(ids);
	if (!parsed.success) throw new AppError("INVALID_INPUT", 422);
	return parsed.data;
}

// Only immutable, visible attachment metadata is returned; bytes still use fileForRead.
const attachments = `coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'filename',f.filename,'mime',f.mime,'byteSize',f.byte_size::text,'previewVersion',f.sha256,
	'thumbnail',case when t.file_id is null then null else jsonb_build_object('version',t.sha256) end) order by f.created_at,f.id)
	from pm.response_attachments a join pm.file_assets f on f.project_id=a.project_id and f.id=a.file_id
	left join pm.image_derivatives t on t.project_id=f.project_id and t.file_id=f.id and t.image_hash=f.sha256 and t.variant=640
	where a.project_id=r.project_id and a.issue_id=r.issue_id and a.response_id=r.id and f.deleted_at is null and f.visibility='customer' and f.purpose='material'),'[]'::jsonb)`;
const response = `jsonb_build_object('id',r.id,'issueRevision',r.issue_revision,'kind',r.kind,'value',r.value,'unit',r.unit,'body',r.body,'authorType',r.author_type,'guestLabel',r.guest_label,'createdAt',r.created_at,'attachments',${attachments})`;
const review = `jsonb_build_object('id',v.id,'responseId',v.response_id,'issueRevision',v.issue_revision,'decision',v.decision,'value',v.value,'unit',v.unit,'source',v.source,'note',v.note,'createdAt',v.created_at)`;

/** Caller holds the shared project/share lock; all joins retain project and file visibility filters. */
async function currentRows(db: PoolClient, projectId: string, ids: string[] | null, fileId: string | null, annotationId: string | null, anchor: string | null, inbox = false, limit = 31) {
	const result = await db.query<{ items: IssueCurrent[]; anchorExists: boolean }>(`
	with ranked as (
	 select i.id,i.created_at,i.closed_at,case when $6::boolean then 0 when i.closed_at is not null then 3 when i.state in ('awaiting_response','remeasure_requested') then 0 when i.state='submitted' then 1 else 2 end priority
	 from pm.issues i join pm.file_assets f on f.project_id=i.project_id and f.id=i.file_id
	 where i.project_id=$1 and f.deleted_at is null and f.visibility='customer' and f.purpose='material'
	 and ($2::uuid[] is null or i.id=any($2)) and ($3::uuid is null or i.file_id=$3) and ($4::uuid is null or i.annotation_id=$4)
	), anchor as (select * from ranked where id=$5::uuid), page as (
	 select * from ranked p where ($5::uuid is null or p.priority>(select priority from anchor)
	 or (p.priority=(select priority from anchor) and (p.created_at,p.id)<(select created_at,id from anchor)))
	 and (not $6::boolean or $2::uuid[] is not null or p.closed_at is null)
	 order by priority,created_at desc,id desc limit $7
	), views as (
	 select p.priority,p.created_at,p.id, (to_jsonb(i)-'annotation_snapshot'-'annotation_id'-'annotation_revision') || jsonb_build_object(
	 'view','current', 'historyCount',(select count(*) from pm.issue_responses where project_id=$1 and issue_id=i.id)+(select count(*) from pm.issue_reviews where project_id=$1 and issue_id=i.id),
	 'fileLabel',f.filename,
	 'annotationLabel',case when $6::boolean and i.annotation_id is not null then coalesce(nullif(i.annotation_snapshot->'metadata'->>'name',''),case i.annotation_snapshot->'geometry'->>'type' when 'line' then '线段' when 'circle' then '圆 / 孔位' when 'arc' then '圆弧' when 'angle' then '角度' when 'ellipse' then '椭圆' else '标注' end) else null end,
	 'annotationNumber',case when $6::boolean and i.annotation_id is not null then (select count(*)::int from pm.annotations a join pm.annotations target on target.project_id=a.project_id and target.file_id=a.file_id and target.id=i.annotation_id and target.deleted_at is null where a.project_id=$1 and a.file_id=i."fileId" and a.deleted_at is null and (a.created_at,a.id)<=(target.created_at,target.id) having count(*)>0) else null end,
	 'file',jsonb_build_object('id',f.id,'filename',f.filename,'mime',f.mime,'byteSize',f.byte_size::text,'previewVersion',f.sha256),
	 'target',case when i.annotation_id is null then null else jsonb_build_object(
	 'annotationRef',jsonb_build_object('id',i.annotation_id,'revision',i.annotation_revision),
	 'annotation',i.annotation_snapshot || jsonb_build_object('id',i.annotation_id),
	 'image',jsonb_build_object('id',f.id,'width',f.width,'height',f.height,'imageHash',f.sha256,'normalizationVersion',f.normalization_version)) end,
	 'responses',coalesce((select jsonb_build_array(${response}) from pm.issue_responses r where r.project_id=$1 and r.issue_id=i.id and r.id=i."latestResponseId"),'[]'::jsonb),
	 'reviews',coalesce((select jsonb_build_array(${review}) from pm.issue_reviews v where v.project_id=$1 and v.issue_id=i.id order by v.issue_revision desc,v.id desc limit 1),'[]'::jsonb)) value
	 from page p join (select ${issueColumns},annotation_snapshot,annotation_id,annotation_revision from pm.issues where project_id=$1) i on i.id=p.id
	 join pm.file_assets f on f.project_id=$1 and f.id=i."fileId"
	) select coalesce((select jsonb_agg(value order by priority,created_at desc,id desc) from views),'[]'::jsonb) items,exists(select 1 from anchor) as "anchorExists"`,
	[projectId, ids, fileId, annotationId, anchor, inbox, limit]);
	const row = result.rows[0];
	if (!row) throw new AppError("DEPENDENCY_UNAVAILABLE", 503);
	if (anchor && !row.anchorExists) throw new AppError("CURSOR_INVALID", 422);
	if (!inbox && ids && row.items.length !== ids.length) throw new AppError("NOT_FOUND", 404);
	return row.items;
}
function scope(actor: Actor, projectId: string, fileId: string, annotationId: string) {
	return cursorScope(["current-issues-v1", actorKey(actor), projectId, fileId, annotationId]);
}
async function currentPage(db: PoolClient, actor: Actor, projectId: string, fileId: string, annotationId: string, cursor: string | null): Promise<IssueCurrentPage> {
	const context = scope(actor, projectId, fileId, annotationId);
	const rows = await currentRows(db, projectId, null, fileId, annotationId, cursorId(cursor, context));
	return { items: rows.slice(0, 30), nextCursor: rows.length > 30 && rows[29] ? queryCursor(rows[29].id, context) : null };
}
export async function currentIssues(actor: Actor, projectId: string, ids: string[]) {
	checkedIds(ids);
	return transaction(actor, async db => {
		await access(db, actor, projectId, false, true);
		return budget({ items: await currentRows(db, projectId, ids, null, null, null) });
	});
}

/** One project lock and one set read for the entire page, with complete current views. */
export async function inboxPage(actor: Actor, projectId: string, cursor: string | null, ids: string[] | null = null, limit = 30) {
	if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new AppError("INVALID_INPUT", 422);
	if (ids && !inboxIds.safeParse(ids).success) throw new AppError("INVALID_INPUT", 422);
	if (ids && cursor) throw new AppError("INVALID_INPUT", 422);
	const context = cursorScope(["inbox-current-v1", actorKey(actor), projectId]);
	return transaction(actor, async db => {
		await access(db, actor, projectId, false, true);
		const rows = await currentRows(db, projectId, ids, null, null, cursorId(cursor, context), true, ids ? 31 : limit + 1);
		const { rows: totals } = await db.query<{ state: string; n: number }>(`select i.state,count(*)::int n from pm.issues i join pm.file_assets f on f.project_id=i.project_id and f.id=i.file_id where i.project_id=$1 and i.closed_at is null and f.deleted_at is null and f.visibility='customer' and f.purpose='material' group by i.state`, [projectId]);
		const counts = Object.fromEntries(totals.map(row => [row.state, row.n]));
		const items = rows.slice(0, ids ? 30 : limit);
		const removed = ids?.filter(id => !rows.some(row => row.id === id)) ?? [];
		const make = () => packInbox(items, counts, !ids && rows.length > items.length && items.at(-1) ? queryCursor(items.at(-1)?.id as string, context) : null, removed);
		let bundle = make();
		while (Buffer.byteLength(JSON.stringify(bundle)) > 1024 * 1024) {
			if (ids || items.length <= 1) throw new AppError("READ_BATCH_TOO_LARGE", 413);
			items.pop(); bundle = make();
		}
		return bundle;
	});
}
export async function fileInteraction(actor: Actor, projectId: string, fileId: string, annotationId: string, cursor: string | null, includeDocument: boolean) {
	return transaction(actor, async db => {
		await access(db, actor, projectId, false, true);
		// This also validates visibility/image readiness once, before issuing current-view reads.
		const document = includeDocument ? (await annotationDocuments(db, actor, projectId, [fileId]))[0] : undefined;
		if (includeDocument) {
			if (!document?.items.some(a => a.id === annotationId && !a.deleted)) throw new AppError("NOT_FOUND", 404);
		} else {
			const visible = await db.query("select a.id from pm.annotations a join pm.file_assets f on f.project_id=a.project_id and f.id=a.file_id where a.project_id=$1 and a.file_id=$2 and a.id=$3 and a.deleted_at is null and f.deleted_at is null and f.visibility='customer' and f.purpose='material'", [projectId, fileId, annotationId]);
			if (!visible.rowCount) throw new AppError("NOT_FOUND", 404);
		}
		const issues = await currentPage(db, actor, projectId, fileId, annotationId, cursor);
		return budget({ ...(includeDocument ? { document } : {}), issues });
	});
}
export async function layers(actor: Actor, projectId: string, ids: string[]) {
	checkedIds(ids);
	return transaction(actor, async db => {
		await access(db, actor, projectId, false, true);
		return budget({ items: await annotationDocuments(db, actor, projectId, ids) });
	});
}
export async function historyPage(actor: Actor, projectId: string, id: string, cursor: string | null, pageSize = 20): Promise<IssueHistoryPage> {
	if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20) throw new AppError("INVALID_INPUT", 422);
	const context = cursorScope(["issue-history-v1", actorKey(actor), projectId, id]);
	const anchor = cursorId(cursor, context);
	return transaction(actor, async db => {
		await access(db, actor, projectId, false, true);
		const { rows } = await db.query<{ items: (IssueHistoryPage["items"][number] & { id: string })[]; anchorExists: boolean }>(`
		with readable as (select i.id from pm.issues i join pm.file_assets f on f.project_id=i.project_id and f.id=i.file_id where i.project_id=$1 and i.id=$2 and f.deleted_at is null and f.visibility='customer' and f.purpose='material'),
		events as (
		 select r.id,r.issue_revision revision,'response' type from pm.issue_responses r where r.project_id=$1 and r.issue_id=$2 and exists(select 1 from readable)
		 union all select v.id,v.issue_revision,'review' from pm.issue_reviews v where v.project_id=$1 and v.issue_id=$2 and exists(select 1 from readable)
		), anchor as (select * from events where id=$3::uuid), page as (
		 select * from events e where $3::uuid is null or (e.revision,e.id)<(select revision,id from anchor) order by revision desc,id desc limit $4
		) select coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'type',p.type,'record',case when p.type='response' then
		 (select ${response} from pm.issue_responses r where r.project_id=$1 and r.issue_id=$2 and r.id=p.id)
		 else (select ${review} from pm.issue_reviews v where v.project_id=$1 and v.issue_id=$2 and v.id=p.id) end) order by p.revision desc,p.id desc) from page p),'[]'::jsonb) items,
		exists(select 1 from anchor) as "anchorExists" from readable`, [projectId, id, anchor, pageSize + 1]);
		const row = rows[0];
		if (!row) throw new AppError("NOT_FOUND", 404);
		if (anchor && !row.anchorExists) throw new AppError("CURSOR_INVALID", 422);
		return budget({ items: row.items.slice(0, pageSize).map(({ id: _id, ...item }) => item), nextCursor: row.items.length > pageSize && row.items[pageSize - 1] ? queryCursor(row.items[pageSize - 1]?.id as string, context) : null });
	});
}
