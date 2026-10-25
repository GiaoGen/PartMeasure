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
		const document = (
			await annotationDocuments(db, actor, projectId, [fileId])
		)[0];
		if (!document) throw new AppError("NOT_FOUND", 404);
		document.items = document.items.filter((item) => !item.deleted);
		const file = await db.query<{ filename: string; byte_size: string }>(
			"select filename,byte_size from pm.file_assets where project_id=$1 and id=$2 and deleted_at is null",
			[projectId, fileId],
		);
		if (!file.rows[0]) throw new AppError("NOT_FOUND", 404);
		const issues = await db.query<ExportIssue>(
			`select i.id,i.annotation_id as "annotationId",i.annotation_revision as "annotationRevision",i.revision,
		 coalesce(i.measurement_field,'dimension') as field,i.state,i.annotation_snapshot as snapshot,
		 case when r.id is null then null else jsonb_build_object('id',r.id,'kind',r.kind,'value',r.value,'unit',r.unit,'body',r.body,'authorType',r.author_type,
		 'evidence',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'filename',f.filename) order by f.id)
		 from pm.response_attachments a join pm.file_assets f on f.project_id=a.project_id and f.id=a.file_id and f.deleted_at is null
		 where a.project_id=i.project_id and a.issue_id=i.id and a.response_id=r.id),'[]'::jsonb)) end as response
		 ,(select jsonb_build_object('id',v.id,'decision',v.decision,'value',v.value,'unit',v.unit,'source',v.source,'note',v.note) from pm.issue_reviews v where v.project_id=i.project_id and v.issue_id=i.id order by v.created_at desc,v.id desc limit 1) as review
		 from pm.issues i left join pm.issue_responses r on r.project_id=i.project_id and r.issue_id=i.id and r.id=i.latest_response_id
		 where i.project_id=$1 and i.file_id=$2 and i.annotation_id=any($3::uuid[]) and i.closed_at is null and i.kind='measurement'
		 order by i.created_at,i.id limit $4`,
			[
				projectId,
				fileId,
				document.items.map((item) => item.id),
				exportLimits.issues + 1,
			],
		);
		const snapshot = {
			schemaVersion: 1 as const,
			capturedAt: new Date().toISOString(),
			project: { id: project.id, name: project.name },
			file: {
				id: fileId,
				filename: file.rows[0].filename,
				byteSize: Number(file.rows[0].byte_size),
			},
			document,
			issues: issues.rows,
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
