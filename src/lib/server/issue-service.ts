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

const columns = `id,file_id as "fileId",kind,title,description,target_info as "targetInfo",measurement_method as "measurementMethod",state,revision,latest_response_id as "latestResponseId",created_at as "createdAt",updated_at as "updatedAt"`;
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
) {
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, false, true);
		if (fileId) await visibleFile(db, projectId, fileId);
		const rank =
			actor.kind === "guest"
				? "case when state in ('awaiting_response','remeasure_requested') then 0 when state='submitted' then 1 else 2 end"
				: "case when state='submitted' then 0 when state='confirmed' then 2 else 1 end";
		const { rows } = await db.query<
			IssueSummary & { priority: number; sort_at: Date }
		>(
			`with ranked as (select ${columns},created_at as sort_at,${rank} as priority from pm.issues where project_id=$1 and ($2::uuid is null or file_id=$2)) select * from ranked r where ($3::uuid is null or r.priority>(select priority from ranked where id=$3) or (r.priority=(select priority from ranked where id=$3) and (r.sort_at,r.id)<(select sort_at,id from ranked where id=$3))) order by priority,sort_at desc,id desc limit 31`,
			[projectId, fileId, cursor],
		);
		const totals = await db.query(
			"select state,count(*)::int as count from pm.issues where project_id=$1 group by state",
			[projectId],
		);
		return {
			items: rows.slice(0, 30).map(({ priority, sort_at, ...item }) => {
				void priority;
				void sort_at;
				return item;
			}),
			nextCursor: rows.length > 30 ? rows[29]?.id : null,
			counts: Object.fromEntries(totals.rows.map((r) => [r.state, r.count])),
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
			'select a.response_id,f.id,f.filename,f.mime,f.byte_size as "byteSize" from pm.response_attachments a join pm.file_assets f on f.id=a.file_id and f.project_id=a.project_id where a.project_id=$1 and a.issue_id=$2 and f.deleted_at is null order by f.created_at,f.id',
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
				if (i.revision !== revision)
					throw new AppError("REVISION_CONFLICT", 409);
				nextState(i.state, "respond");
				validateResponse(i.kind, input);
				const count = await db.query(
					"select count(*)::int as n from pm.issue_responses where project_id=$1 and issue_id=$2",
					[projectId, id],
				);
				if (count.rows[0].n >= 100) throw new AppError("RESPONSE_LIMIT", 409);
				const files = [];
				for (const fileId of [...input.evidenceFileIds].sort())
					files.push(await visibleFile(db, projectId, fileId));
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
					"insert into pm.issue_responses(project_id,issue_id,issue_revision,kind,value,unit,body,author_type,owner_id,guest_session_id,guest_label) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id",
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
				for (const file of files)
					await db.query(
						"insert into pm.response_attachments(project_id,issue_id,response_id,file_id) values($1,$2,$3,$4)",
						[projectId, id, responseId, file.id],
					);
				await db.query(
					"update pm.issues set state='submitted',revision=revision+1,latest_response_id=$3,updated_at=now() where project_id=$1 and id=$2",
					[projectId, id, responseId],
				);
				await audit(db, actor, projectId, "issue.respond", responseId);
				return { responseId, state: "submitted", revision: revision + 1 };
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
					"insert into pm.issue_reviews(project_id,issue_id,response_id,issue_revision,decision,value,unit,source,note,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
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
				await db.query(
					"update pm.issues set state=$3,revision=revision+1,updated_at=now() where project_id=$1 and id=$2",
					[projectId, id, state],
				);
				await audit(
					db,
					actor,
					projectId,
					`issue.${input.decision}`,
					rows[0].id,
				);
				return { reviewId: rows[0].id, state, revision: revision + 1 };
			},
		);
	});
}
