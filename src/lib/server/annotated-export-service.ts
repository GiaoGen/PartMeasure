import "server-only";
import { type Actor, transaction, digest, rate } from "./db";
import { access, actorKey } from "./service";
import { annotationDocuments } from "./annotation-service";
import {
	checkExportSize,
	exportDescription,
	exportLimits,
	type AnnotatedExport,
	type ExportIssue,
} from "../annotated-export";
import { AppError } from "../policy";
import type { PoolClient } from "pg";
import type { Project } from "./service";

/** All business writes take the project's exclusive lock. Keep one shared lock
 * across aggregation; no per-field waterfall and no client draft is accepted. */
export async function annotatedExport(
	actor: Actor,
	projectId: string,
	fileId: string,
): Promise<AnnotatedExport> {
	return transaction(actor, async (db) => {
		const { project } = await access(db, actor, projectId, false, true);
		await rate(db, `${projectId}:${actorKey(actor)}:image-export`, 12);
		const result = (
			await captureExportDocuments(db, actor, project, [fileId])
		)[0];
		if (!result) throw new AppError("NOT_FOUND", 404);
		return result;
	});
}
/** Caller holds the project read lock for the complete batch and any history. */
export async function captureExportDocuments(
	db: PoolClient,
	actor: Actor,
	project: Pick<Project, "id" | "name">,
	fileIds: string[],
	capturedAt = new Date().toISOString(),
): Promise<AnnotatedExport[]> {
	const projectId = project.id;
	const documents = await annotationDocuments(db, actor, projectId, fileIds);
	for (const document of documents)
		document.items = document.items.filter((item) => !item.deleted);
	const files = await db.query<{
		id: string;
		filename: string;
		byte_size: string;
	}>(
		"select id,filename,byte_size from pm.file_assets where project_id=$1 and id=any($2::uuid[]) and deleted_at is null",
		[projectId, fileIds],
	);
	if (files.rows.length !== fileIds.length)
		throw new AppError("NOT_FOUND", 404);
	const issues = await db.query<ExportIssue & { fileId: string }>(
		`select i.file_id as "fileId",i.id,i.annotation_id as "annotationId",i.annotation_revision as "annotationRevision",i.revision,
		 coalesce(i.measurement_field,'dimension') as field,i.state,i.annotation_snapshot as snapshot,
		 case when r.id is null then null else jsonb_build_object('id',r.id,'kind',r.kind,'value',r.value,'unit',r.unit,'body',r.body,'authorType',r.author_type,
		 'evidence',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'filename',f.filename) order by f.id)
		 from pm.response_attachments a join pm.file_assets f on f.project_id=a.project_id and f.id=a.file_id and f.deleted_at is null
		 where a.project_id=i.project_id and a.issue_id=i.id and a.response_id=r.id),'[]'::jsonb)) end as response
		 ,(select jsonb_build_object('id',v.id,'decision',v.decision,'value',v.value,'unit',v.unit,'source',v.source,'note',v.note) from pm.issue_reviews v where v.project_id=i.project_id and v.issue_id=i.id order by v.created_at desc,v.id desc limit 1) as review
		 from pm.issues i left join pm.issue_responses r on r.project_id=i.project_id and r.issue_id=i.id and r.id=i.latest_response_id
		 where i.project_id=$1 and i.file_id=any($2::uuid[]) and i.annotation_id=any($3::uuid[]) and i.closed_at is null and i.kind='measurement'
		 order by i.created_at,i.id limit $4`,
		[
			projectId,
			fileIds,
			documents.flatMap((document) => document.items.map((item) => item.id)),
			exportLimits.issues * fileIds.length + 1,
		],
	);
	if (issues.rows.length > exportLimits.issues * fileIds.length)
		throw new AppError("EXPORT_LIMIT", 413);
	return fileIds.map((fileId) => {
		const document = documents.find((document) => document.image.id === fileId),
			file = files.rows.find((file) => file.id === fileId);
		if (!document || !file) throw new AppError("NOT_FOUND", 404);
		const snapshot = {
			schemaVersion: 1 as const,
			capturedAt,
			project: { id: project.id, name: project.name },
			file: {
				id: fileId,
				filename: file.filename,
				byteSize: Number(file.byte_size),
			},
			document,
			issues: issues.rows
				.filter((issue) => issue.fileId === fileId)
				.map(({ fileId: _fileId, ...issue }) => issue),
		};
		checkExportSize(snapshot);
		const result = {
			...snapshot,
			snapshotId: digest(JSON.stringify(snapshot)),
		};
		exportDescription(result);
		return result;
	});
}
