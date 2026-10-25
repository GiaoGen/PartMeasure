import "server-only";
import type { PoolClient } from "pg";
import { type Actor, transaction, digest, rate } from "./db";
import { access, actorKey } from "./service";
import { captureExportDocuments } from "./annotated-export-service";
import { captureExportHistory } from "./export-history";
import { AppError } from "../policy";
import {
	checkZipSnapshot,
	safeZipFilename,
	zipLimits,
	zipSelectionSchema,
	type ZipSelection,
	type ZipSnapshot,
	type ZipFile,
	type ZipData,
} from "../zip-package";
type FileRow = {
	id: string;
	filename: string;
	mime: string;
	byte_size: string;
	sha256: string;
	original_bytes: string;
	original_sha256: string;
};
type Sources = {
	files: ZipFile[];
	images: string[];
	delivery: ZipData["delivery"];
};
const fields =
	"f.id,f.filename,f.mime,f.byte_size,f.sha256,f.original_bytes,f.original_sha256";
async function selectedSources(
	db: PoolClient,
	actor: Actor,
	projectId: string,
	selection: ZipSelection,
): Promise<Sources> {
	if (actor.kind === "guest" && selection.originals)
		throw new AppError("FORBIDDEN", 403);
	const material = await db.query<FileRow>(
		`select ${fields} from pm.file_assets f where f.project_id=$1 and f.id=any($2::uuid[]) and f.purpose='material' and f.deleted_at is null and ($3::boolean or f.visibility='customer')`,
		[projectId, selection.materialIds, actor.kind === "owner"],
	);
	if (material.rows.length !== selection.materialIds.length)
		throw new AppError("NOT_FOUND", 404);
	const files: ZipFile[] = [],
		images: string[] = [];
	for (const id of selection.materialIds) {
		const file = material.rows.find((file) => file.id === id);
		if (!file) throw new AppError("NOT_FOUND", 404);
		const image = file.mime === "image/webp";
		const filename = image
			? file.filename.replace(/\.[^.]+$/, ".webp")
			: file.filename;
		files.push({
			id,
			filename: file.filename,
			mime: file.mime,
			byteSize: Number(file.byte_size),
			sha256: file.sha256,
			variant: image ? "standard" : "material",
			deliveryId: null,
			path: `materials/${id}/${safeZipFilename(filename)}`,
		});
		if (image) {
			images.push(id);
			if (selection.originals)
				files.push({
					id,
					filename: file.filename,
					mime: "application/octet-stream",
					byteSize: Number(file.original_bytes),
					sha256: file.original_sha256,
					variant: "original",
					deliveryId: null,
					path: `originals/${id}/${safeZipFilename(file.filename)}`,
				});
		}
	}
	let delivery: ZipData["delivery"] = null;
	if (selection.delivery) {
		const release = await db.query<{
			id: string;
			version_no: number;
			revision: number;
			description: string;
			published_at: Date;
		}>(
			"select id,version_no,revision,description,published_at from pm.deliveries where project_id=$1 and id=$2 and state='published'",
			[projectId, selection.delivery.id],
		);
		const version = release.rows[0];
		if (!version) throw new AppError("NOT_FOUND", 404);
		const attachments = await db.query<FileRow>(
			`select ${fields} from pm.delivery_files a join pm.file_assets f on f.project_id=a.project_id and f.id=a.file_id where a.project_id=$1 and a.delivery_id=$2 and a.selected and f.id=any($3::uuid[]) and f.purpose='delivery' and f.deleted_at is null and ($4::boolean or f.visibility='customer')`,
			[
				projectId,
				version.id,
				selection.delivery.fileIds,
				actor.kind === "owner",
			],
		);
		if (attachments.rows.length !== selection.delivery.fileIds.length)
			throw new AppError("NOT_FOUND", 404);
		for (const id of selection.delivery.fileIds) {
			const file = attachments.rows.find((file) => file.id === id);
			if (!file) throw new AppError("NOT_FOUND", 404);
			files.push({
				id,
				filename: file.filename,
				mime: file.mime,
				byteSize: Number(file.byte_size),
				sha256: file.sha256,
				variant: "delivery",
				deliveryId: version.id,
				path: `deliveries/V${String(version.version_no).padStart(3, "0")}/${id}/${safeZipFilename(file.mime === "image/webp" ? file.filename.replace(/\.[^.]+$/, ".webp") : file.filename)}`,
			});
		}
		delivery = {
			id: version.id,
			versionNo: version.version_no,
			revision: version.revision,
			description: version.description,
			publishedAt: version.published_at.toISOString(),
			selectedFileIds: selection.delivery.fileIds,
		};
	}
	if (
		files.reduce((sum, file) => sum + file.byteSize, 0) + 524288 >
		zipLimits.bytes
	)
		throw new AppError("ZIP_LIMIT", 413);
	return { files, images, delivery };
}
export async function zipAccess(
	actor: Actor,
	projectId: string,
	input: ZipSelection,
) {
	const parsed = zipSelectionSchema.safeParse(input);
	if (!parsed.success) throw new AppError("INVALID_INPUT", 422);
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, false, true);
		return {
			files: (await selectedSources(db, actor, projectId, parsed.data)).files,
		};
	});
}
export async function zipSnapshot(
	actor: Actor,
	projectId: string,
	input: ZipSelection,
): Promise<ZipSnapshot> {
	const parsed = zipSelectionSchema.safeParse(input);
	if (!parsed.success) throw new AppError("INVALID_INPUT", 422);
	return transaction(actor, async (db) => {
		const { project } = await access(db, actor, projectId, false, true);
		await rate(db, `${projectId}:${actorKey(actor)}:zip-package`, 6);
		const selection = parsed.data,
			capturedAt = new Date().toISOString(),
			sources = await selectedSources(db, actor, projectId, selection);
		const photos = sources.images.length
			? await captureExportDocuments(
					db,
					actor,
					project,
					sources.images,
					capturedAt,
				)
			: [];
		const annotations = photos.flatMap((photo) =>
			photo.document.items.map((item) => item.id),
		);
		if (
			annotations.length > zipLimits.annotations ||
			photos.reduce((sum, photo) => sum + photo.issues.length, 0) >
				zipLimits.issues
		)
			throw new AppError("ZIP_LIMIT", 413);
		const history = await captureExportHistory(
			db,
			projectId,
			sources.images,
			annotations,
			zipLimits.history,
		);
		if (history.length > zipLimits.history)
			throw new AppError("ZIP_LIMIT", 413);
		// Guest cannot list the private revision table. These are exactly the fixed
		// snapshots of already-visible measurement issues, under the existing RLS.
		const fixed = await db.query<ZipData["fixedAnnotations"][number]>(
			`select distinct on (file_id,annotation_id,annotation_revision) file_id as "fileId",annotation_id as "annotationId",annotation_revision as revision,annotation_snapshot as annotation,'issue_snapshot' as source from pm.issues where project_id=$1 and file_id=any($2::uuid[]) and annotation_id=any($3::uuid[]) and annotation_snapshot is not null order by file_id,annotation_id,annotation_revision,id limit $4`,
			[projectId, sources.images, annotations, zipLimits.fixed + 1],
		);
		const data: ZipData = {
			schemaVersion: 1,
			capturedAt,
			photos,
			history,
			fixedAnnotations: fixed.rows,
			delivery: sources.delivery,
		};
		const payload = {
			schemaVersion: 1 as const,
			capturedAt,
			project: {
				id: project.id,
				name: project.name,
				description: project.description,
				revision: project.revision,
			},
			selection,
			files: sources.files,
			data,
		};
		const snapshot = {
			...payload,
			snapshotId: digest(JSON.stringify(payload)),
		};
		checkZipSnapshot(snapshot);
		return snapshot;
	});
}
