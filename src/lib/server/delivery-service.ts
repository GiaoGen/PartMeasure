import "server-only";
import type { PoolClient } from "pg";
import type { Delivery, DeliveryDraftInput } from "../deliveries";
import { AppError } from "../policy";
import { type Actor, transaction, idempotent } from "./db";
import { access, actorKey, audit } from "./service";
const columns =
	'id,description,state,revision,version_no as "versionNo",created_at as "createdAt",published_at as "publishedAt"';
async function delivery(
	db: PoolClient,
	projectId: string,
	id: string,
	lock = false,
): Promise<Delivery> {
	const row = (
		await db.query(
			`select ${columns} from pm.deliveries where project_id=$1 and id=$2 ${lock ? "for update" : ""}`,
			[projectId, id],
		)
	).rows[0];
	if (!row) throw new AppError("NOT_FOUND", 404);
	const files = (
		await db.query(
			'select f.id,f.filename,f.mime,f.byte_size as "byteSize" from pm.delivery_files a join pm.file_assets f on f.project_id=a.project_id and f.id=a.file_id where a.project_id=$1 and a.delivery_id=$2 and a.selected order by a.position',
			[projectId, id],
		)
	).rows;
	return { ...row, files };
}
async function validateFiles(db: PoolClient, projectId: string, ids: string[]) {
	for (const id of [...ids].sort()) {
		const result = await db.query(
			"select f.id from pm.file_assets f join pm.upload_reservations r on r.id=f.reservation_id and r.project_id=f.project_id where f.project_id=$1 and f.id=$2 and f.purpose='delivery' and f.uploader_type='owner' and f.deleted_at is null and r.state='ready' and r.purpose='delivery' for update of f",
			[projectId, id],
		);
		if (!result.rows[0]) throw new AppError("DELIVERY_FILE_UNAVAILABLE", 422);
	}
}
export async function getDelivery(actor: Actor, projectId: string, id: string) {
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, false, true);
		return delivery(db, projectId, id);
	});
}
export async function listDeliveries(actor: Actor, projectId: string) {
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, false, true);
		const { rows } = await db.query<Delivery>(
			`with chosen as (
			 (select ${columns} from pm.deliveries where project_id=$1 and state='published' order by version_no desc limit 1)
			 union all
			 (select ${columns} from pm.deliveries where project_id=$1 and state='draft' and $2::boolean order by created_at,id limit 5)
			) select chosen.*, coalesce((
			 select jsonb_agg(jsonb_build_object('id',f.id,'filename',f.filename,'mime',f.mime,'byteSize',f.byte_size::text) order by a.position)
			 from pm.delivery_files a join pm.file_assets f on f.project_id=a.project_id and f.id=a.file_id
			 where a.project_id=$1 and a.delivery_id=chosen.id and a.selected
			), '[]'::jsonb) as files from chosen order by "createdAt",id`,
			[projectId, actor.kind === "owner"],
		);
		return {
			published: rows.find(row => row.state === "published") ?? null,
			drafts: rows.filter(row => row.state === "draft"),
		};
	});
}
export async function saveDelivery(
	actor: Actor,
	projectId: string,
	id: string | null,
	input: DeliveryDraftInput,
	revision: number | null,
	key: string,
) {
	if (actor.kind !== "owner") throw new AppError("FORBIDDEN", 403);
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, true);
		return idempotent(
			db,
			`${projectId}:${actorKey(actor)}:delivery-save`,
			key,
			{ id, input, revision },
			async () => {
				if (id) {
					const current = await delivery(db, projectId, id, true);
					if (current.state !== "draft")
						throw new AppError("DELIVERY_PUBLISHED", 409);
					if (current.revision !== revision)
						throw new AppError("REVISION_CONFLICT", 409);
				} else {
					const count = (
						await db.query(
							"select count(*)::int as n from pm.deliveries where project_id=$1 and state='draft'",
							[projectId],
						)
					).rows[0].n;
					if (count >= 5) throw new AppError("DELIVERY_DRAFT_LIMIT", 409);
				}
				await validateFiles(db, projectId, input.fileIds);
				const saved = id
					? (
							await db.query(
								"update pm.deliveries set description=$3,revision=revision+1,updated_at=now() where project_id=$1 and id=$2 returning id",
								[projectId, id, input.description],
							)
						).rows[0]
					: (
							await db.query(
								"insert into pm.deliveries(project_id,description,created_by) values($1,$2,$3) returning id",
								[projectId, input.description, actor.id],
							)
						).rows[0];
				await db.query(
					"update pm.delivery_files set selected=false where project_id=$1 and delivery_id=$2 and selected",
					[projectId, saved.id],
				);
				for (const [position, fileId] of input.fileIds.entries())
					await db.query(
						"insert into pm.delivery_files(project_id,delivery_id,file_id,position) values($1,$2,$3,$4) on conflict(delivery_id,file_id) do update set selected=true,position=excluded.position",
						[projectId, saved.id, fileId, position + 1],
					);
				await audit(db, actor, projectId, "delivery.save-draft", saved.id);
				return delivery(db, projectId, saved.id);
			},
		);
	});
}
export async function publishDelivery(
	actor: Actor,
	projectId: string,
	id: string,
	revision: number,
	key: string,
) {
	if (actor.kind !== "owner") throw new AppError("FORBIDDEN", 403);
	return transaction(actor, async (db) => {
		await access(db, actor, projectId, true);
		return idempotent(
			db,
			`${projectId}:${actorKey(actor)}:delivery-publish`,
			key,
			{ id, revision },
			async () => {
				const draft = await delivery(db, projectId, id, true);
				if (draft.state !== "draft")
					throw new AppError("DELIVERY_PUBLISHED", 409);
				if (draft.revision !== revision)
					throw new AppError("REVISION_CONFLICT", 409);
				if (draft.files.length < 1 || draft.files.length > 20)
					throw new AppError("DELIVERY_FILES_REQUIRED", 422);
				await validateFiles(
					db,
					projectId,
					draft.files.map((f) => f.id),
				);
				const number = (
					await db.query(
						"select coalesce(max(version_no),0)+1 as next from pm.deliveries where project_id=$1",
						[projectId],
					)
				).rows[0].next;
				await db.query(
					"update pm.deliveries set state='published',version_no=$3,published_by=$4,published_at=now(),revision=revision+1,updated_at=now() where project_id=$1 and id=$2",
					[projectId, id, number, actor.id],
				);
				await db.query(
					"update pm.file_assets set history_protected=true,visibility='customer' where project_id=$1 and id=any($2::uuid[]) and (not history_protected or visibility<>'customer')",
					[projectId, draft.files.map((f) => f.id)],
				);
				await audit(db, actor, projectId, "delivery.publish", id);
				return delivery(db, projectId, id);
			},
		);
	});
}
