import "server-only";
import { AppError } from "../policy";
import {
	projectFiltersSchema,
	type ProjectFilters,
	type FolderSummary,
} from "../project-folders";
import { type Actor, transaction } from "./db";
import { folderForOwner } from "./folder-service";
import { cursorScope, cursorId, queryCursor } from "./query-cursor";

type ProjectItem = {
	id: string;
	name: string;
	description: string;
	revision: number;
	createdAt: string;
	folderId: string | null;
	folder: FolderSummary | null;
};
export async function queryProjects(
	actor: Actor,
	cursor: string | null,
	filters: ProjectFilters,
) {
	if (actor.kind !== "owner") throw new AppError("FORBIDDEN", 403);
	const parsed = projectFiltersSchema.safeParse(filters);
	if (!parsed.success) throw new AppError("INVALID_INPUT", 422);
	const { folderId, q } = parsed.data;
	const scope = cursorScope([
		"projects-v1",
		actor.id,
		folderId,
		q,
		"created-desc",
	]);
	const anchor = cursorId(cursor, scope, folderId === null && q === "");
	return transaction(actor, async (db) => {
		if (folderId && folderId !== "none")
			await folderForOwner(db, actor.id, folderId);
		// Rows, anchors and all three count scopes share a single statement snapshot.
		const { rows } = await db.query<{
			items: ProjectItem[];
			counts: {
				allCount: number;
				folderCount: number;
				searchMatchCount: number;
			};
			anchorExists: boolean;
		}>(
			`with matched as (
			 select p.id,p.name,p.description,p.revision,p.created_at,p.folder_id
			 from pm.projects p where p.owner_id=$1
			 and ($2::text is null or ($2='none' and folder_id is null) or folder_id=nullif($2,'none')::uuid)
			 and ($3='' or strpos(lower(name),lower($3))>0 or strpos(lower(description),lower($3))>0)
			), anchor as (select created_at,id from matched where id=$4::uuid), page as (
			 select * from matched where $4::uuid is null or (created_at,id)<(select created_at,id from anchor)
			 order by created_at desc,id desc limit 31
			), projected as (
			 select p.id,p.name,p.description,p.revision,p.created_at as "createdAt",p.folder_id as "folderId",
			 case when f.id is null then null else jsonb_build_object('id',f.id,'name',f.name,'color',f.color) end as folder
			 from page p left join pm.project_folders f on f.id=p.folder_id and f.owner_id=$1
			)
			select coalesce((select jsonb_agg(to_jsonb(p) order by p."createdAt" desc,p.id desc) from projected p),'[]'::jsonb) as items,
			jsonb_build_object('allCount',(select count(*) from pm.projects where owner_id=$1),
			'folderCount',(select count(*) from pm.projects where owner_id=$1 and ($2::text is null or ($2='none' and folder_id is null) or folder_id=nullif($2,'none')::uuid)),
			'searchMatchCount',(select count(*) from matched)) as counts,
			exists(select 1 from anchor) as "anchorExists"`,
			[actor.id, folderId, q, anchor],
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
			filters: { folderId, q, sort: "created-desc" as const },
		};
	});
}
