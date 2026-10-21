import "server-only";
import { isDeepStrictEqual } from "node:util";
import { geometryTarget } from "../geometry-extensions";
import { requiredMeasurements } from "../annotation-collaboration";
import type { PoolClient } from "pg";
import type { z } from "zod";
import {
	type Annotation,
	type CanonicalImage,
	type FileIssue,
	type createAnnotationSchema,
	type updateAnnotationSchema,
	type fileIssueSchema,
	validateAnnotation,
} from "../annotations";
import { AppError } from "../policy";
import { type Actor, transaction, idempotent } from "./db";
import { access, actorKey, audit } from "./service";
import { syncAnnotationMeasurements } from "./annotation-collaboration";
type Row = {
	schema_version?: 1 | 2;
	collaboration?: Annotation["collaboration"];
	measurement_responses?: {
		field: import("../annotation-collaboration").MeasurementField;
		value: string;
		unit: string;
		snapshot: Pick<Annotation, "geometry" | "metadata">;
	}[];
	id: string;
	geometry: Annotation["geometry"];
	metadata: Annotation["metadata"];
	revision: number;
	deleted_at: Date | null;
	created_at: Date;
	updated_at: Date;
	file_id: string;
	image_hash: string;
};
const dto = (r: Row): Annotation => ({
	schemaVersion: r.schema_version ?? 1,
	...(r.collaboration
		? {
				collaboration: {
					...r.collaboration,
					values: Object.fromEntries(
						(r.measurement_responses ?? [])
							.filter(
								(reply) =>
									requiredMeasurements({
										id: r.id,
										geometry: r.geometry,
										metadata: r.metadata,
									}).includes(reply.field) &&
									isDeepStrictEqual(
										geometryTarget(r.geometry),
										geometryTarget(reply.snapshot.geometry),
									) &&
									(r.geometry.type !== "circle" ||
										r.metadata.circleMeasure ===
											reply.snapshot.metadata.circleMeasure),
							)
							.map((reply) => [
								reply.field,
								{ value: reply.value, unit: reply.unit },
							]),
					),
				},
			}
		: {}),
	id: r.id,
	geometry: r.geometry,
	metadata: r.metadata,
	revision: r.revision,
	deleted: r.deleted_at !== null,
	createdAt: r.created_at.toISOString(),
	updatedAt: r.updated_at.toISOString(),
});
async function target(
	db: PoolClient,
	projectId: string,
	fileId: string,
	imageOnly: boolean,
) {
	const { rows } = await db.query(
		"select id,mime,width,height,sha256,normalization_version from pm.file_assets where project_id=$1 and id=$2 and deleted_at is null and purpose='material'",
		[projectId, fileId],
	);
	const f = rows[0];
	if (!f) throw new AppError("NOT_FOUND", 404);
	if (
		imageOnly &&
		(f.mime !== "image/webp" ||
			!f.width ||
			!f.height ||
			f.normalization_version !== 1)
	)
		throw new AppError("IMAGE_NOT_READY", 409);
	return f as {
		id: string;
		mime: string;
		width: number;
		height: number;
		sha256: string;
		normalization_version: 1;
	};
}
export async function annotations(
	actor: Actor,
	projectId: string,
	fileId: string,
) {
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, false, true);
		const f = await target(db, projectId, fileId, true);
		const { rows } = await db.query<Row>(
			`select a.*,jsonb_build_object('pending',c.pending,'submitted',c.submitted,'remeasure',c.remeasure) as collaboration,c.measurement_responses from pm.annotations a
			 left join lateral (select count(*) filter(where i.state='awaiting_response')::int pending,
			 count(*) filter(where i.state='remeasure_requested')::int remeasure,
			 count(*) filter(where i.state='submitted')::int submitted,
			 coalesce(jsonb_agg(jsonb_build_object('field',coalesce(i.measurement_field,'dimension'),'value',r.value,'unit',r.unit,'snapshot',i.annotation_snapshot) order by i.created_at,i.id) filter(where i.state='submitted' and r.kind='numeric'),'[]'::jsonb) measurement_responses
			 from pm.issues i left join pm.issue_responses r on r.project_id=i.project_id and r.issue_id=i.id and r.id=i.latest_response_id
			 where i.project_id=a.project_id and i.file_id=a.file_id and i.annotation_id=a.id and i.closed_at is null) c on true
			 where a.project_id=$1 and a.file_id=$2 and ($3::boolean or a.deleted_at is null) order by a.created_at,a.id`,
			[projectId, fileId, actor.kind === "owner"],
		);
		const image: CanonicalImage = {
			id: f.id,
			width: f.width,
			height: f.height,
			imageHash: f.sha256,
			normalizationVersion: f.normalization_version,
		};
		return { image, items: rows.map(dto) };
	});
}
export async function createAnnotation(
	actor: Actor,
	projectId: string,
	input: z.infer<typeof createAnnotationSchema>,
	key: string,
) {
	if (actor.kind !== "owner") throw new AppError("FORBIDDEN", 403);
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, true);
		return idempotent(
			db,
			`${projectId}:${actorKey(actor)}:annotation-create`,
			key,
			input,
			async () => {
				const f = await target(db, projectId, input.fileId, true);
				if (f.sha256 !== input.imageHash)
					throw new AppError("IMAGE_VERSION_CONFLICT", 409);
				validateAnnotation(input.geometry, input.metadata, f.width, f.height);
				const count = await db.query(
					"select count(*)::int as n from pm.annotations where project_id=$1 and file_id=$2",
					[projectId, input.fileId],
				);
				if (count.rows[0].n >= 200) throw new AppError("ANNOTATION_LIMIT", 409);
				const { rows } = await db.query<Row>(
					"insert into pm.annotations(id,project_id,file_id,image_hash,normalization_version,geometry,metadata,revision,schema_version) values($1,$2,$3,$4,1,$5,$6,1,$7) returning *",
					[
						input.id,
						projectId,
						input.fileId,
						input.imageHash,
						JSON.stringify(input.geometry),
						JSON.stringify(input.metadata),
						["angle", "arc", "ellipse"].includes(input.geometry.type) ? 2 : 1,
					],
				);
				await audit(db, actor, projectId, "annotation.create", input.id);
				await syncAnnotationMeasurements(
					db,
					actor,
					projectId,
					input.fileId,
					dto(rows[0] as Row),
				);
				return dto(rows[0] as Row);
			},
		);
	});
}
export async function changeAnnotation(
	actor: Actor,
	projectId: string,
	id: string,
	input: z.infer<typeof updateAnnotationSchema> | null,
	revision: number,
	key: string,
) {
	if (actor.kind !== "owner") throw new AppError("FORBIDDEN", 403);
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, true);
		return idempotent(
			db,
			`${projectId}:${actorKey(actor)}:annotation-${input ? "edit" : "hide"}`,
			key,
			{ id, input, revision },
			async () => {
				const { rows } = await db.query<Row>(
					"select * from pm.annotations where project_id=$1 and id=$2 for update",
					[projectId, id],
				);
				const old = rows[0];
				if (!old) throw new AppError("NOT_FOUND", 404);
				const f = await target(db, projectId, old.file_id, true);
				if (old.revision !== revision)
					throw new AppError("REVISION_CONFLICT", 409);
				if (input && f.sha256 !== input.imageHash)
					throw new AppError("IMAGE_VERSION_CONFLICT", 409);
				if (input && old.geometry.type !== input.geometry.type)
					throw new AppError("INVALID_GEOMETRY", 422);
				if (input)
					validateAnnotation(input.geometry, input.metadata, f.width, f.height);
				if (old.revision >= 10000)
					throw new AppError("ANNOTATION_REVISION_LIMIT", 409);
				const next = await db.query<Row>(
					"update pm.annotations set geometry=$3,metadata=$4,revision=revision+1,deleted_at=case when $5 then now() else null end,updated_at=now() where project_id=$1 and id=$2 returning *",
					[
						projectId,
						id,
						JSON.stringify(input?.geometry ?? old.geometry),
						JSON.stringify(input?.metadata ?? old.metadata),
						input === null,
					],
				);
				await audit(
					db,
					actor,
					projectId,
					input ? "annotation.edit" : "annotation.hide",
					id,
				);
				await syncAnnotationMeasurements(
					db,
					actor,
					projectId,
					old.file_id,
					dto(next.rows[0] as Row),
				);
				return dto(next.rows[0] as Row);
			},
		);
	});
}
export async function revisions(
	actor: Actor,
	projectId: string,
	id: string,
	before: number | null,
) {
	if (actor.kind !== "owner") throw new AppError("FORBIDDEN", 403);
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, false, true);
		const head = await db.query<Row>(
			"select * from pm.annotations where project_id=$1 and id=$2",
			[projectId, id],
		);
		if (!head.rows[0]) throw new AppError("NOT_FOUND", 404);
		await target(db, projectId, head.rows[0].file_id, true);
		const { rows } = await db.query(
			'select revision,geometry,metadata,deleted,created_at as "createdAt" from pm.annotation_revisions where project_id=$1 and annotation_id=$2 and ($3::integer is null or revision<$3) order by revision desc limit 31',
			[projectId, id, before],
		);
		return {
			items: rows.slice(0, 30),
			nextBefore: rows.length > 30 ? rows[29].revision : null,
		};
	});
}
export async function fileIssues(
	actor: Actor,
	projectId: string,
	fileId: string,
	cursor: string | null,
) {
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, false, true);
		await target(db, projectId, fileId, false);
		const { rows } = await db.query<FileIssue>(
			'select id,file_id as "fileId",kind,title,description,created_at as "createdAt" from pm.issues where project_id=$1 and file_id=$2 and ($3::uuid is null or (created_at,id)<(select created_at,id from pm.issues where id=$3 and project_id=$1 and file_id=$2)) order by created_at desc,id desc limit 31',
			[projectId, fileId, cursor],
		);
		return {
			items: rows.slice(0, 30),
			nextCursor: rows.length > 30 ? rows[29]?.id : null,
		};
	});
}
export async function createFileIssue(
	actor: Actor,
	projectId: string,
	input: z.infer<typeof fileIssueSchema>,
	key: string,
) {
	if (actor.kind !== "owner") throw new AppError("FORBIDDEN", 403);
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, true);
		return idempotent(
			db,
			`${projectId}:${actorKey(actor)}:file-issue-create`,
			key,
			input,
			async () => {
				await target(db, projectId, input.fileId, false);
				const count = await db.query(
					"select count(*)::int as n from pm.issues where project_id=$1 and file_id=$2",
					[projectId, input.fileId],
				);
				if (count.rows[0].n >= 200) throw new AppError("FILE_ISSUE_LIMIT", 409);
				const { rows } = await db.query<FileIssue>(
					'insert into pm.issues(project_id,file_id,title,description,created_by) values($1,$2,$3,$4,$5) returning id,file_id as "fileId",kind,title,description,state,revision,target_info as "targetInfo",measurement_method as "measurementMethod",latest_response_id as "latestResponseId",created_at as "createdAt",updated_at as "updatedAt"',
					[projectId, input.fileId, input.title, input.description, actor.id],
				);
				await audit(
					db,
					actor,
					projectId,
					"issue.comment-create",
					(rows[0] as FileIssue).id,
				);
				return rows[0];
			},
		);
	});
}
