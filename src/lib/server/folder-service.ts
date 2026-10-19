import "server-only";
import type { PoolClient } from "pg";
import { AppError } from "../policy";
import {
	folderLimit,
	type FolderInput,
	type FolderSummary,
	type ProjectFolder,
} from "../project-folders";
import { type Actor, transaction, idempotent } from "./db";

export async function folderForOwner(
	db: PoolClient,
	ownerId: string,
	folderId: string | null,
): Promise<FolderSummary | null> {
	if (folderId === null) return null;
	const row = (
		await db.query<FolderSummary>(
			"select id,name,color from pm.project_folders where id=$1 and owner_id=$2",
			[folderId, ownerId],
		)
	).rows[0];
	if (!row) throw new AppError("NOT_FOUND", 404);
	return row;
}
export async function listFolders(actor: Actor) {
	if (actor.kind !== "owner") throw new AppError("FORBIDDEN", 403);
	return transaction(actor, async (db) => ({
		items: (
			await db.query<ProjectFolder>(
				`select f.id,f.name,f.description,f.color,f.revision,f.created_at as "createdAt",f.updated_at as "updatedAt",count(p.id)::int as "projectCount"
			 from pm.project_folders f left join pm.projects p on p.folder_id=f.id and p.owner_id=f.owner_id
			 where f.owner_id=$1 group by f.id order by f.created_at,f.id`,
				[actor.id],
			)
		).rows,
		limit: folderLimit,
	}));
}
export async function createFolder(
	actor: Actor,
	input: FolderInput,
	key: string,
) {
	if (actor.kind !== "owner") throw new AppError("FORBIDDEN", 403);
	try {
		return await transaction(actor, (db) =>
			idempotent(
				db,
				`owner:${actor.id}:folder-create`,
				key,
				input,
				async () => {
					await db.query(
						"insert into pm.owner_usage(owner_id) values($1) on conflict do nothing",
						[actor.id],
					);
					await db.query(
						"select owner_id from pm.owner_usage where owner_id=$1 for update",
						[actor.id],
					);
					const { rows } = await db.query(
						"select count(*)::int as n from pm.project_folders where owner_id=$1",
						[actor.id],
					);
					if (rows[0].n >= folderLimit)
						throw new AppError("FOLDER_LIMIT_REACHED", 409);
					return (
						await db.query<ProjectFolder>(
							`insert into pm.project_folders(owner_id,name,description,color) values($1,$2,$3,$4)
				 returning id,name,description,color,revision,created_at as "createdAt",updated_at as "updatedAt",0 as "projectCount"`,
							[actor.id, input.name, input.description, input.color],
						)
					).rows[0];
				},
			),
		);
	} catch (error) {
		const pg = error as { code?: string; constraint?: string };
		if (
			pg.code === "23505" &&
			pg.constraint === "project_folders_owner_name_key"
		)
			throw new AppError("FOLDER_NAME_EXISTS", 409);
		throw error;
	}
}
