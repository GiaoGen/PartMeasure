import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { AppError } from "../policy";
import {
	type IssueDetail,
	type IssueSummary,
	type IssueResponse,
	type IssueReview,
	type ResponseInput,
	type ReviewInput,
	type measurementSchema,
	nextState,
	validateResponse,
	validateReview,
} from "../issues";
import type { AnnotationDraft } from "../annotations";
import { type Actor, transaction, idempotent } from "./db";
import { access, actorKey, audit } from "./service";
import { validateMeasurementUnit } from "../annotation-collaboration";
import { cursorScope, cursorId, queryCursor } from "./query-cursor";

const columns = `closed_at as "closedAt",closure_note as "closureNote",measurement_field as "measurementField",id,file_id as "fileId",kind,title,description,target_info as "targetInfo",measurement_method as "measurementMethod",state,revision,latest_response_id as "latestResponseId",created_at as "createdAt",updated_at as "updatedAt",case when annotation_id is null then null else jsonb_build_object('id',annotation_id,'revision',annotation_revision) end as "annotationRef"`;
async function head(
	db: PoolClient,
	projectId: string,
	id: string,
	lock = false,
) {
	const { rows } = await db.query<
		IssueSummary & {
			annotation_id: string | null;
			annotation_revision: number | null;
			annotation_snapshot: Pick<
				AnnotationDraft,
				"geometry" | "metadata"
			> | null;
		}
	>(
		`select ${columns},annotation_id,annotation_revision,annotation_snapshot from pm.issues where project_id=$1 and id=$2 ${lock ? "for update" : ""}`,
		[projectId, id],
	);
	if (!rows[0]) throw new AppError("NOT_FOUND", 404);
	return rows[0];
}
async function visibleFile(db: PoolClient, projectId: string, fileId: string) {
	const { rows } = await db.query(
		"select id,filename,mime,byte_size as \"byteSize\",width,height,sha256,normalization_version from pm.file_assets where project_id=$1 and id=$2 and deleted_at is null and visibility='customer' and purpose='material'",
		[projectId, fileId],
	);
	if (!rows[0]) throw new AppError("ATTACHMENT_UNAVAILABLE", 422);
	return rows[0];
}
export async function listIssues(
	actor: Actor,
	projectId: string,
	cursor: string | null,
	fileId: string | null = null,
	annotationId: string | null = null,
) {
	if (annotationId && !fileId) throw new AppError("INVALID_INPUT", 422);
	const scope = cursorScope([
		"issues-v2",
		actorKey(actor),
		projectId,
		fileId,
		annotationId,
		"priority-created-desc",
	]);
	const anchor = cursorId(cursor, scope, !fileId && !annotationId);
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, false, true);
		if (fileId) await visibleFile(db, projectId, fileId);
		const rank =
			"case when state in ('awaiting_response','remeasure_requested') then 0 when state='submitted' then 1 else 2 end";
		const { rows } = await db.query<{
			items: IssueSummary[];
			counts: Record<string, number>;
			filteredCounts: Record<string, number>;
			anchorExists: boolean;
		}>(
			`with ranked as (select ${columns},file_id,annotation_id,created_at as sort_at,case when closed_at is not null then 3 else ${rank} end as priority from pm.issues where project_id=$1 and (closed_at is null or $4::uuid is not null) and ($2::uuid is null or file_id=$2) and ($4::uuid is null or annotation_id=$4)),
			 anchor as (select priority,sort_at,id from ranked where id=$3::uuid),
			 page as (select * from ranked r where $3::uuid is null or r.priority>(select priority from anchor) or (r.priority=(select priority from anchor) and (r.sort_at,r.id)<(select sort_at,id from anchor)) order by priority,sort_at desc,id desc limit 31)
			 select coalesce((select jsonb_agg(to_jsonb(p)-'priority'-'sort_at'-'file_id'-'annotation_id' order by priority,sort_at desc,id desc) from page p),'[]'::jsonb) as items,
			 coalesce((select jsonb_object_agg(state,n) from (select state,count(*)::int n from pm.issues where project_id=$1 and closed_at is null group by state) t),'{}'::jsonb) as counts,
			 coalesce((select jsonb_object_agg(state,n) from (select state,count(*)::int n from ranked where "closedAt" is null group by state) t),'{}'::jsonb) as "filteredCounts",
			 exists(select 1 from anchor) as "anchorExists"`,
			[projectId, fileId, anchor, annotationId],
		);
		const result = rows[0];
		if (!result) throw new AppError("DEPENDENCY_UNAVAILABLE", 503);
		if (anchor && !result.anchorExists)
			throw new AppError("CURSOR_INVALID", 422);
		const next = result.items[29];
		return {
			items: result.items.slice(0, 30),
			nextCursor:
				result.items.length > 30 && next ? queryCursor(next.id, scope) : null,
			counts: result.counts,
			countScope: "project" as const,
			filteredCounts: result.filteredCounts,
			filterScope: annotationId
				? ("annotation" as const)
				: fileId
					? ("file" as const)
					: ("project" as const),
		};
	});
}
export async function detailIssue(
	actor: Actor,
	projectId: string,
	id: string,
): Promise<IssueDetail> {
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, false, true);
		const i = await head(db, projectId, id),
			file = await visibleFile(db, projectId, i.fileId);
		const responses = await db.query<Omit<IssueResponse, "attachments">>(
			'select id,issue_revision as "issueRevision",kind,value,unit,body,author_type as "authorType",guest_label as "guestLabel",created_at as "createdAt" from pm.issue_responses where project_id=$1 and issue_id=$2 order by created_at,id limit 100',
			[projectId, id],
		);
		const attachments = await db.query(
			`select a.response_id,f.id,f.filename,f.mime,f.byte_size as "byteSize",f.sha256 as "previewVersion",case when t.file_id is null then null else jsonb_build_object('version',t.sha256) end as thumbnail from pm.response_attachments a join pm.file_assets f on f.id=a.file_id and f.project_id=a.project_id left join pm.image_derivatives t on t.file_id=f.id and t.project_id=f.project_id and t.image_hash=f.sha256 and t.variant=640 where a.project_id=$1 and a.issue_id=$2 and f.deleted_at is null order by f.created_at,f.id`,
			[projectId, id],
		);
		const reviews = await db.query<IssueReview>(
			'select id,response_id as "responseId",issue_revision as "issueRevision",decision,value,unit,source,note,created_at as "createdAt" from pm.issue_reviews where project_id=$1 and issue_id=$2 order by created_at,id limit 100',
			[projectId, id],
		);
		const {
			annotation_id,
			annotation_revision,
			annotation_snapshot,
			...summary
		} = i;
		return {
			...summary,
			file: {
				id: file.id,
				filename: file.filename,
				mime: file.mime,
				byteSize: file.byteSize,
			},
			target:
				annotation_id && annotation_revision && annotation_snapshot
					? {
							annotationRef: {
								id: annotation_id,
								revision: annotation_revision,
							},
							annotation: { id: annotation_id, ...annotation_snapshot },
							image: {
								id: file.id,
								width: file.width,
								height: file.height,
								imageHash: file.sha256,
								normalizationVersion: file.normalization_version,
							},
						}
					: null,
			responses: responses.rows.map((r) => ({
				...r,
				attachments: attachments.rows
					.filter((a) => a.response_id === r.id)
					.map(({ response_id, ...f }) => {
						void response_id;
						return f as IssueResponse["attachments"][number];
					}),
			})),
			reviews: reviews.rows,
		};
	});
}
export async function createMeasurement(
	actor: Actor,
	projectId: string,
	input: z.infer<typeof measurementSchema>,
	key: string,
) {
	if (actor.kind !== "owner") throw new AppError("FORBIDDEN", 403);
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, true);
		return idempotent(
			db,
			`${projectId}:${actorKey(actor)}:measurement-create`,
			key,
			input,
			async () => {
				await visibleFile(db, projectId, input.fileId);
				const { rows } = await db.query(
					"select r.geometry,r.metadata,a.revision from pm.annotation_revisions r join pm.annotations a on a.id=r.annotation_id and a.project_id=r.project_id where r.project_id=$1 and r.file_id=$2 and r.annotation_id=$3 and r.revision=$4 and not r.deleted and a.deleted_at is null",
					[
						projectId,
						input.fileId,
						input.annotationRef.id,
						input.annotationRef.revision,
					],
				);
				if (!rows[0]) throw new AppError("NOT_FOUND", 404);
				if (rows[0].revision !== input.annotationRef.revision)
					throw new AppError("REVISION_CONFLICT", 409);
				const count = await db.query(
					"select count(*)::int as n from pm.issues where project_id=$1 and file_id=$2",
					[projectId, input.fileId],
				);
				if (count.rows[0].n >= 200) throw new AppError("FILE_ISSUE_LIMIT", 409);
				const inserted = await db.query(
					`insert into pm.issues(project_id,file_id,kind,title,description,target_info,measurement_method,annotation_id,annotation_revision,annotation_snapshot,created_by) values($1,$2,'measurement',$3,$4,$5,$6,$7,$8,$9,$10) returning ${columns}`,
					[
						projectId,
						input.fileId,
						input.title,
						input.description,
						input.targetInfo,
						input.measurementMethod,
						input.annotationRef.id,
						input.annotationRef.revision,
						JSON.stringify({
							geometry: rows[0].geometry,
							metadata: rows[0].metadata,
						}),
						actor.id,
					],
				);
				await audit(
					db,
					actor,
					projectId,
					"issue.measurement-create",
					inserted.rows[0].id,
				);
				return inserted.rows[0] as IssueSummary;
			},
		);
	});
}
export async function respondIssue(
	actor: Actor,
	projectId: string,
	id: string,
	input: ResponseInput,
	revision: number,
	key: string,
) {
	return transaction(actor, async (db) => {
		await access(db, actor, projectId);
		return idempotent(
			db,
			`${projectId}:${actorKey(actor)}:issue-response`,
			key,
			{ id, input, revision },
			async () => {
				const i = await head(db, projectId, id, true);
				if (i.closedAt) throw new AppError("CLOSED_MEASUREMENT", 409);
				if (i.revision !== revision)
					throw new AppError("REVISION_CONFLICT", 409);
				nextState(i.state, "respond");
				validateResponse(i.kind, input);
				if (input.kind === "numeric")
					validateMeasurementUnit(i.measurementField, input.unit, input.value);
				const count = await db.query(
					"select count(*)::int as n from pm.issue_responses where project_id=$1 and issue_id=$2",
					[projectId, id],
				);
				if (count.rows[0].n >= 100) throw new AppError("RESPONSE_LIMIT", 409);
				const files = input.evidenceFileIds.length
					? (
							await db.query(
								`select f.id,f.filename,f.mime,f.byte_size as "byteSize",f.sha256 as "previewVersion",case when t.file_id is null then null else jsonb_build_object('version',t.sha256) end as thumbnail from pm.file_assets f left join pm.image_derivatives t on t.file_id=f.id and t.project_id=f.project_id and t.image_hash=f.sha256 and t.variant=640
					 where f.project_id=$1 and f.id=any($2::uuid[]) and f.deleted_at is null and f.visibility='customer' and f.purpose='material'
					 order by f.created_at,f.id`,
								[projectId, input.evidenceFileIds],
							)
						).rows
					: [];
				if (files.length !== input.evidenceFileIds.length)
					throw new AppError("ATTACHMENT_UNAVAILABLE", 422);
				if (
					input.kind === "photo" &&
					!files.some((f) => f.mime === "image/webp")
				)
					throw new AppError("PHOTO_EVIDENCE_REQUIRED", 422);
				const guestId =
					actor.kind === "guest"
						? (
								await db.query(
									"select id from pm.guest_sessions where token_hash=$1 and project_id=$2",
									[actor.hash, projectId],
								)
							).rows[0]?.id
						: null;
				if (actor.kind === "guest" && !guestId)
					throw new AppError("LINK_UNAVAILABLE", 401);
				const { rows } = await db.query(
					`insert into pm.issue_responses(project_id,issue_id,issue_revision,kind,value,unit,body,author_type,owner_id,guest_session_id,guest_label) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
					 returning id,issue_revision as "issueRevision",kind,value,unit,body,author_type as "authorType",guest_label as "guestLabel",created_at as "createdAt"`,
					[
						projectId,
						id,
						revision,
						input.kind,
						input.kind === "numeric" ? input.value : null,
						input.kind === "numeric" ? input.unit : null,
						input.body,
						actor.kind,
						actor.kind === "owner" ? actor.id : null,
						guestId,
						input.guestLabel,
					],
				);
				const responseId = rows[0].id;
				if (files.length)
					await db.query(
						"insert into pm.response_attachments(project_id,issue_id,response_id,file_id) select $1,$2,$3,unnest($4::uuid[])",
						[projectId, id, responseId, files.map((f) => f.id)],
					);
				const updated = await db.query(
					"update pm.issues set state='submitted',revision=revision+1,latest_response_id=$3,updated_at=now() where project_id=$1 and id=$2 returning updated_at as \"updatedAt\"",
					[projectId, id, responseId],
				);
				await audit(db, actor, projectId, "issue.respond", responseId);
				return {
					responseId,
					issueId: id,
					state: "submitted",
					revision: revision + 1,
					updatedAt: updated.rows[0].updatedAt,
					response: { ...rows[0], attachments: files },
				};
			},
		);
	});
}
export async function reviewIssue(
	actor: Actor,
	projectId: string,
	id: string,
	input: ReviewInput,
	revision: number,
	key: string,
) {
	if (actor.kind !== "owner") throw new AppError("FORBIDDEN", 403);
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, true);
		return idempotent(
			db,
			`${projectId}:${actorKey(actor)}:issue-review`,
			key,
			{ id, input, revision },
			async () => {
				const i = await head(db, projectId, id, true);
				if (i.closedAt) throw new AppError("CLOSED_MEASUREMENT", 409);
				if (i.revision !== revision)
					throw new AppError("REVISION_CONFLICT", 409);
				const state = nextState(i.state, input.decision);
				if (i.latestResponseId !== input.responseId)
					throw new AppError("RESPONSE_CONFLICT", 409);
				const response = await db.query(
					"select kind,value,unit from pm.issue_responses where project_id=$1 and issue_id=$2 and id=$3",
					[projectId, id, input.responseId],
				);
				if (!response.rows[0]) throw new AppError("NOT_FOUND", 404);
				validateReview(i.kind, response.rows[0], input);
				const { rows } = await db.query(
					`insert into pm.issue_reviews(project_id,issue_id,response_id,issue_revision,decision,value,unit,source,note,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
					 returning id,response_id as "responseId",issue_revision as "issueRevision",decision,value,unit,source,note,created_at as "createdAt"`,
					[
						projectId,
						id,
						input.responseId,
						revision,
						input.decision,
						input.value,
						input.unit,
						input.source,
						input.note,
						actor.id,
					],
				);
				const updated = await db.query(
					'update pm.issues set state=$3,revision=revision+1,updated_at=now() where project_id=$1 and id=$2 returning updated_at as "updatedAt"',
					[projectId, id, state],
				);
				await audit(
					db,
					actor,
					projectId,
					`issue.${input.decision}`,
					rows[0].id,
				);
				return {
					reviewId: rows[0].id,
					issueId: id,
					state,
					revision: revision + 1,
					updatedAt: updated.rows[0].updatedAt,
					review: rows[0],
				};
			},
		);
	});
}
