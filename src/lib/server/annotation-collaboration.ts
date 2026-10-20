import "server-only";
import { isDeepStrictEqual } from "node:util";
import { geometryTarget } from "../geometry-extensions";
import type { PoolClient } from "pg";
import type { Annotation } from "../annotations";
import {
	requiredMeasurements,
	measurementFieldLabel,
	type MeasurementField,
} from "../annotation-collaboration";
import { AppError } from "../policy";
import { audit } from "./service";
import type { Actor } from "./db";

// Called inside the annotation write transaction, after its immutable revision exists.
// Project -> annotation -> issues is the same lock order as reply/review writes.
export async function syncAnnotationMeasurements(
	db: PoolClient,
	actor: Actor,
	projectId: string,
	fileId: string,
	item: Annotation,
) {
	if (actor.kind !== "owner") throw new AppError("FORBIDDEN", 403);
	const { rows } = await db.query(
		"select id,state,measurement_field,annotation_revision,annotation_snapshot from pm.issues where project_id=$1 and annotation_id=$2 and closed_at is null order by created_at,id for update",
		[projectId, item.id],
	);
	const required = item.deleted ? [] : requiredMeasurements(item);
	const current = new Set<MeasurementField>();
	for (const issue of rows) {
		const field: MeasurementField = issue.measurement_field ?? "dimension";
		const snapshot = issue.annotation_snapshot;
		const sameTarget =
			isDeepStrictEqual(
				snapshot?.geometry ? geometryTarget(snapshot.geometry) : null,
				geometryTarget(item.geometry),
			) &&
			(field !== "dimension" ||
				item.geometry.type !== "circle" ||
				snapshot?.metadata.circleMeasure === item.metadata.circleMeasure) &&
			(snapshot?.metadata.measurementInstructions ?? "") ===
				(item.metadata.measurementInstructions ?? "") &&
			(snapshot?.metadata.measurementMethod ?? "unspecified") ===
				(item.metadata.measurementMethod ?? "unspecified");
		if (issue.state === "confirmed") {
			// Historical confirmations remain readable; legacy values were not written back.
			if (sameTarget && issue.annotation_revision === item.revision)
				current.add(field);
			continue;
		}
		if (
			!item.deleted &&
			required.includes(field) &&
			!item.metadata[field] &&
			sameTarget
		) {
			current.add(field);
			continue;
		}
		const note = item.deleted
			? "标注已隐藏"
			: !required.includes(field)
				? "工程师设为仅说明或取消该字段要求"
				: item.metadata[field]
					? "工程师已填写尺寸"
					: "测量位置或要求已变更，请以新项为准";
		await db.query(
			"update pm.issues set closed_at=now(),closure_note=$3,closed_by=$4,closure_annotation_revision=$5,revision=revision+1,updated_at=now() where project_id=$1 and id=$2",
			[projectId, issue.id, note, actor.id, item.revision],
		);
		await audit(db, actor, projectId, "annotation.measurement-close", issue.id);
	}
	for (const field of required) {
		if (item.metadata[field] || current.has(field)) continue;
		const label = measurementFieldLabel(item, field);
		const { rows: inserted } = await db.query(
			`insert into pm.issues(project_id,file_id,kind,title,description,target_info,measurement_method,annotation_id,annotation_revision,annotation_snapshot,created_by,measurement_field)
			values($1,$2,'measurement',$3,'',$4,$5,$6,$7,$8,$9,$10) returning id`,
			[
				projectId,
				fileId,
				`${item.metadata.name || "标注"} · ${label}`.slice(0, 120),
				item.metadata.measurementInstructions?.trim() ||
					`请补充所标位置的${label}，也可上传测量照片或说明无法测量。`,
				field === "holeDepth"
					? "depth"
					: (item.metadata.measurementMethod ?? "unspecified"),
				item.id,
				item.revision,
				JSON.stringify({ geometry: item.geometry, metadata: item.metadata }),
				actor.id,
				field,
			],
		);
		await audit(
			db,
			actor,
			projectId,
			"annotation.measurement-open",
			inserted[0].id,
		);
	}
}
