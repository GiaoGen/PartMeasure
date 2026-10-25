import { captureExportHistory } from "./export-history";
import "server-only";
import { captureExportDocuments } from "./annotated-export-service";
import { type Actor, transaction, rate, digest } from "./db";
import { access, actorKey } from "./service";
import {
	checkPdfReport,
	pdfLimits,
	pdfSelectionSchema,
	type PdfReport,
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
		const history = await captureExportHistory(
			db,
			projectId,
			fileIds,
			annotationIds,
			pdfLimits.records,
		);
		const data = {
			schemaVersion: 1 as const,
			capturedAt,
			project: { id: project.id, name: project.name },
			photos,
			history,
		};
		const report = { ...data, snapshotId: digest(JSON.stringify(data)) };
		checkPdfReport(report);
		return report;
	});
}
