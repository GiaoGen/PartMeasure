import "server-only";
import { captureExportDocuments } from "./annotated-export-service";
import { type Actor, transaction, rate, digest } from "./db";
import { access, actorKey } from "./service";
import {
	checkPdfReport,
	pdfLimits,
	pdfSelectionSchema,
	type PdfReport,
	type ReportHistory,
} from "../pdf-report";
import { AppError } from "../policy";

export async function pdfReport(
	actor: Actor,
	projectId: string,
	fileIds: string[],
): Promise<PdfReport> {
	if (!pdfSelectionSchema.safeParse({ fileIds }).success)
		throw new AppError("INVALID_INPUT", 422);
	return transaction(actor, async (db) => {
		const { project } = await access(db, actor, projectId, false, true);
		await rate(db, `${projectId}:${actorKey(actor)}:pdf-report`, 6);
		const capturedAt = new Date().toISOString();
		const photos = await captureExportDocuments(
			db,
			actor,
			project,
			fileIds,
			capturedAt,
		);
		const annotationIds = photos.flatMap((photo) =>
			photo.document.items.map((item) => item.id),
		);
		if (annotationIds.length > pdfLimits.annotations)
			throw new AppError("PDF_LIMIT", 413);
		const history = await db.query<
			Omit<ReportHistory, "createdAt"> & { createdAt: Date }
		>(
			`with targets as (
		 select * from pm.issues where project_id=$1 and file_id=any($2::uuid[]) and annotation_id=any($3::uuid[]) and kind='measurement'
		), history as (
		 select r.id,i.file_id as "fileId",i.annotation_id as "annotationId",i.annotation_revision as "annotationRevision",i.id as "issueId",r.issue_revision as "issueRevision",r.created_at as "createdAt",'response' as kind,
		 jsonb_build_object('id',r.id,'kind',r.kind,'value',r.value,'unit',r.unit,'body',r.body,'authorType',r.author_type,'evidence',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'filename',f.filename) order by f.id) from pm.response_attachments a join pm.file_assets f on f.project_id=a.project_id and f.id=a.file_id and f.deleted_at is null where a.project_id=i.project_id and a.issue_id=i.id and a.response_id=r.id),'[]'::jsonb)) as record
		 from targets i join pm.issue_responses r on r.project_id=i.project_id and r.issue_id=i.id
		 union all
		 select v.id,i.file_id,i.annotation_id,i.annotation_revision,i.id,v.issue_revision,v.created_at,'review',jsonb_build_object('id',v.id,'decision',v.decision,'value',v.value,'unit',v.unit,'source',v.source,'note',v.note)
		 from targets i join pm.issue_reviews v on v.project_id=i.project_id and v.issue_id=i.id
		 union all
		 select i.id,i.file_id,i.annotation_id,i.annotation_revision,i.id,i.revision,i.closed_at,'closure',jsonb_build_object('note',i.closure_note) from targets i where i.closed_at is not null
		) select * from history order by "createdAt",id,kind limit $4`,
			[projectId, fileIds, annotationIds, pdfLimits.records + 1],
		);
		const data = {
			schemaVersion: 1 as const,
			capturedAt,
			project: { id: project.id, name: project.name },
			photos,
			history: history.rows.map((entry) => ({
				...entry,
				createdAt: entry.createdAt.toISOString(),
			})),
		};
		const report = { ...data, snapshotId: digest(JSON.stringify(data)) };
		checkPdfReport(report);
		return report;
	});
}
