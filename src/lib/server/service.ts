import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { AppError, limits, uploadPolicy } from "../policy";
import { type Actor, digest, idempotent, token, transaction } from "./db";
import { effectiveFileLimit } from "./file-limits";
import { appOrigin } from "./origin";
import { folderForOwner } from "./folder-service";
import { queryProjects } from "./project-query";
import type { ProjectFilters } from "../project-folders";
import { eventCursor } from "./event-cursor";
import { imageCacheScope } from "./image-cache-scope";
import type { ImageAccess } from "../image-access";
import { type FileFilters, fileFiltersSchema, defaultFileFilters } from "../archive-filters";
import { cursorScope, cursorId, queryCursor } from "./query-cursor";

export type Project = {
	id: string;
	name: string;
	description: string;
	revision: number;
	owner_id: string;
	created_at: string;
	folder_id: string | null;
	archived_at: string | null;
};
export const actorKey = (actor: Actor) =>
	actor.kind === "owner" ? `owner:${actor.id}` : `guest:${actor.hash}`;
export async function access(
	db: PoolClient,
	actor: Actor,
	projectId: string,
	manage = false,
	readOnly = false,
	allowArchivedOwner = false,
) {
	const { rows } = await db.query<Project>(
		`select id,name,description,revision,owner_id,created_at,folder_id,archived_at from pm.projects where id=$1 ${readOnly ? "for share" : "for update"}`,
		[projectId],
	);
	const project = rows[0];
	if (!project)
		throw new AppError(
			actor.kind === "guest" ? "LINK_UNAVAILABLE" : "NOT_FOUND",
			actor.kind === "guest" ? 401 : 404,
		);
	if (actor.kind === "owner" && project.owner_id !== actor.id)
		throw new AppError("NOT_FOUND", 404);
	if (actor.kind === "guest") {
		if (manage) throw new AppError("FORBIDDEN", 403);
		const { rows: sessions } = await db.query(
			`select s.id,s.share_id from pm.guest_sessions s join pm.share_links l on l.id=s.share_id
   where s.token_hash=$1 and s.project_id=$2 and s.expires_at>now() and l.revoked_at is null and l.expires_at>now() ${readOnly ? "for share of l" : "for update of l"}`,
			[actor.hash, projectId],
		);
		if (!sessions[0]) throw new AppError("LINK_UNAVAILABLE", 401);
		if (project.archived_at && !readOnly) throw new AppError("PROJECT_ARCHIVED", 409);
		return { project, shareId: sessions[0].share_id as string, sessionId: sessions[0].id as string };
	}
	if (project.archived_at && !readOnly && !allowArchivedOwner) throw new AppError("PROJECT_ARCHIVED", 409);
	return { project, shareId: null, sessionId: null };
}
export const publicProject = (p: Project) => ({
	id: p.id,
	name: p.name,
	description: p.description,
	revision: p.revision,
	createdAt: p.created_at,
	archivedAt: p.archived_at,
});
export async function archiveProject(actor: Actor, id: string, archived: boolean, revision: number, key: string) {
	if (actor.kind !== "owner") throw new AppError("FORBIDDEN", 403);
	return transaction(actor, async db => {
		const { project } = await access(db, actor, id, true, false, true);
		return idempotent(db, `${id}:${actorKey(actor)}:archive`, key, { archived, revision }, async () => {
			if (project.revision !== revision) throw new AppError("REVISION_CONFLICT", 409);
			if (!!project.archived_at === archived) return publicProject(project);
			const { rows } = await db.query<Project>("update pm.projects set archived_at=case when $2 then now() else null end,revision=revision+1,updated_at=now() where id=$1 returning *", [id, archived]);
			const updated = rows[0];
			if (!updated) throw new AppError("NOT_FOUND", 404);
			await audit(db, actor, id, archived ? "project.archive" : "project.restore", id);
			return publicProject(updated);
		});
	});
}
export async function audit(
	db: PoolClient,
	actor: Actor,
	projectId: string,
	action: string,
	objectId: string,
) {
	await db.query(
		"insert into pm.audit_events(project_id,actor_type,action,object_id) values($1,$2,$3,$4)",
		[projectId, actor.kind, action, objectId],
	);
}
export async function listProjects(
	actor: Actor,
	cursor: string | null,
	filters: ProjectFilters = { folderId: null, q: "" },
) {
	return queryProjects(actor, cursor, filters);
}
export async function createProject(
	actor: Actor,
	input: {
		name: string;
		description: string;
		folderId?: string | null | undefined;
	},
	key: string,
) {
	if (actor.kind !== "owner") throw new AppError("FORBIDDEN", 403);
	return transaction(actor, (db) =>
		idempotent(db, `${actorKey(actor)}:create`, key, input, async () => {
			const folder = await folderForOwner(db, actor.id, input.folderId ?? null);
			await db.query(
				"insert into pm.owner_usage(owner_id) values($1) on conflict do nothing",
				[actor.id],
			);
			const { rows } = await db.query<Project>(
				"insert into pm.projects(owner_id,name,description,folder_id) values($1,$2,$3,$4) returning *",
				[actor.id, input.name, input.description, input.folderId ?? null],
			);
			const project = rows[0];
			if (!project) throw new AppError("DEPENDENCY_UNAVAILABLE", 503);
			await audit(db, actor, project.id, "project.create", project.id);
			return { ...publicProject(project), folderId: project.folder_id, folder };
		}),
	);
}
export async function projectDetail(actor: Actor, id: string) {
	return transaction(actor, async (db) => {
		const { project } = await access(db, actor, id, false, true);
		const data = publicProject(project);
		const { rows } = await db.query(
			`select c.${actor.kind === "owner" ? "owner_seq" : "guest_seq"}::text as sequence,
             (select jsonb_build_object('id',id,'expiresAt',expires_at,'revokedAt',revoked_at) from pm.share_links where project_id=$1 order by created_at desc limit 1) as share
             from pm.project_event_cursors c where project_id=$1`,
			[id],
		);
		return {
			...data,
			...(actor.kind === "owner"
				? {
						folderId: project.folder_id,
						folder: await folderForOwner(db, actor.id, project.folder_id),
					}
				: {}),
			share: actor.kind === "owner" ? (rows[0]?.share ?? null) : null,
			syncCursor: eventCursor(actor, id, rows[0]?.sequence ?? "0"),
		};
	});
}
export async function editProject(
	actor: Actor,
	id: string,
	input: { name: string; description: string },
	revision: number,
	key: string,
) {
	return transaction(actor, async (db) => {
		await access(db, actor, id, true);
		return idempotent(
			db,
			`${id}:${actorKey(actor)}:edit`,
			key,
			{ ...input, revision },
			async () => {
				const { rows } = await db.query<Project>(
					"update pm.projects set name=$2,description=$3,revision=revision+1,updated_at=now() where id=$1 and revision=$4 returning *",
					[id, input.name, input.description, revision],
				);
				if (!rows[0]) throw new AppError("REVISION_CONFLICT", 409);
				await audit(db, actor, id, "project.edit", id);
				return {
					...publicProject(rows[0]),
					folderId: rows[0].folder_id,
					folder: await folderForOwner(db, rows[0].owner_id, rows[0].folder_id),
				};
			},
		);
	});
}
export async function rotateShare(actor: Actor, id: string, key: string) {
	// Raw capability is never persisted in idempotency records: response loss requires another explicit rotation.
	const raw = token();
	return transaction(actor, async (db) => {
		await access(db, actor, id, true);
		const result = await idempotent(
			db,
			`${id}:${actorKey(actor)}:share`,
			key,
			{},
			async () => {
				await db.query(
					"update pm.share_links set revoked_at=now() where project_id=$1 and revoked_at is null",
					[id],
				);
				const { rows } = await db.query(
					'insert into pm.share_links(project_id,token_hash) values($1,$2) returning id,expires_at as "expiresAt"',
					[id, digest(raw)],
				);
				await audit(db, actor, id, "share.rotate", rows[0].id);
				return {
					id: rows[0].id as string,
					expiresAt: rows[0].expiresAt as string,
					hash: digest(raw),
				};
			},
		);
		return {
			id: result.id,
			expiresAt: result.expiresAt,
			url: result.hash === digest(raw) ? `${appOrigin()}/s/${raw}` : null,
			replayed: result.hash !== digest(raw),
		};
	});
}
export async function revokeShare(
	actor: Actor,
	id: string,
	shareId: string,
	key: string,
) {
	return transaction(actor, async (db) => {
		await access(db, actor, id, true, false, true);
		return idempotent(
			db,
			`${id}:${actorKey(actor)}:revoke`,
			key,
			{ shareId },
			async () => {
				const { rowCount } = await db.query(
					"update pm.share_links set revoked_at=coalesce(revoked_at,now()) where id=$1 and project_id=$2",
					[shareId, id],
				);
				if (!rowCount) throw new AppError("NOT_FOUND", 404);
				await audit(db, actor, id, "share.revoke", shareId);
				return { revoked: true };
			},
		);
	});
}
export async function bootstrap(raw: string) {
	const secret = token();
	const hash = digest(raw);
	return transaction(null, async (db) => {
		await db.query("select set_config('pm.link_hash',$1,true)", [hash]);
		const lookup = await db.query(
			"select project_id from pm.share_links where token_hash=$1 and revoked_at is null and expires_at>now()",
			[hash],
		);
		if (!lookup.rows[0]) throw new AppError("LINK_UNAVAILABLE", 401);
		// Serialize with revoke by locking share; bootstrap does not hold a project lock and never locks project afterwards.
		const { rows } = await db.query(
			"select id,project_id from pm.share_links where token_hash=$1 and revoked_at is null and expires_at>now() for update",
			[hash],
		);
		if (!rows[0]) throw new AppError("LINK_UNAVAILABLE", 401);
		await db.query(
			`insert into pm.guest_sessions(project_id,share_id,token_hash,expires_at) select project_id,id,$2,least(expires_at,now()+interval '24 hours') from pm.share_links where id=$1`,
			[rows[0].id, digest(secret)],
		);
		return { projectId: rows[0].project_id as string, secret };
	});
}
export async function reserve(
	actor: Actor,
	id: string,
	input: {
		filename: string;
		byteSize: number;
		declaredMime: string;
		sha256: string;
		purpose?: "material" | "delivery" | undefined;
	},
	key: string,
) {
	const purpose = input.purpose ?? "material";
	if (purpose === "delivery" && actor.kind !== "owner")
		throw new AppError("FORBIDDEN", 403);
	if (input.byteSize > effectiveFileLimit())
		throw new AppError("STORAGE_FILE_TOO_LARGE", 413);
	const policy = uploadPolicy(
		input.filename,
		input.byteSize,
		input.declaredMime,
	);
	return transaction(actor, async (db) => {
		// Serialize all projects of this owner before project/share locks, including guest reservations.
		const ownerLookup = await db.query(
			"select owner_id from pm.projects where id=$1",
			[id],
		);
		if (!ownerLookup.rows[0]) throw new AppError("NOT_FOUND", 404);
		const ownerId = ownerLookup.rows[0].owner_id;
		await db.query(
			"select owner_id from pm.owner_usage where owner_id=$1 for update",
			[ownerId],
		);
		const { shareId } = await access(db, actor, id);
		// Expired interaction windows stop occupying concurrency slots, but keep all storage budget reserved until cleanup.
		await db.query(
			"update pm.upload_reservations set state='rejected',error_code='UPLOAD_WINDOW_EXPIRED' where project_id=$1 and state='reserved' and created_at<now()-interval '15 minutes'",
			[id],
		);
		return idempotent(
			db,
			`${id}:${actorKey(actor)}:reserve`,
			key,
			input,
			async () => {
				const duplicate = await db.query(
					"select id,state,actor_key,(created_at<now()-interval '15 minutes') as expired from pm.upload_reservations where project_id=$1 and sha256=$2 and byte_size=$3 and purpose=$4 and state in ('reserved','queued','processing','ready')",
					[id, input.sha256, input.byteSize, purpose],
				);
				if (duplicate.rows[0]) {
					if (duplicate.rows[0].actor_key !== actorKey(actor))
						throw new AppError("DUPLICATE_FILE", 409);
					if (
						duplicate.rows[0].state === "reserved" &&
						duplicate.rows[0].expired
					) {
						await db.query(
							"update pm.upload_reservations set state='rejected',error_code='UPLOAD_WINDOW_EXPIRED' where id=$1",
							[duplicate.rows[0].id],
						);
					} else return { id: duplicate.rows[0].id as string, duplicate: true };
				}
				const { rows } = await db.query(
					`select p.used_bytes+coalesce((select sum(reserved_bytes) from pm.upload_reservations where project_id=p.id and state not in ('ready','cleaned')),0)+coalesce((select sum(reserved_bytes) from pm.thumbnail_jobs where project_id=p.id),0) as project_bytes,
   (select used_bytes+reserved_bytes from pm.owner_usage where owner_id=p.owner_id) as account_bytes,
   coalesce((select sum(byte_size) from pm.upload_reservations where project_id=p.id and created_at>=date_trunc('day',now())),0) as daily_bytes,
   (select count(*) from pm.upload_reservations where project_id=p.id and state in ('reserved','queued','processing')) as pending,
   (select count(*) from pm.upload_reservations where project_id=p.id and actor_key=$2 and state in ('reserved','queued','processing')) as actor_pending
   from pm.projects p where p.id=$1`,
					[id, actorKey(actor)],
				);
				const usage = rows[0];
				if (
					Number(usage.project_bytes) + policy.budget > limits.project ||
					Number(usage.account_bytes) + policy.budget > limits.account ||
					Number(usage.daily_bytes) + input.byteSize > limits.daily
				)
					throw new AppError("QUOTA_EXCEEDED", 413);
				if (Number(usage.pending) >= 4 || Number(usage.actor_pending) >= 2)
					throw new AppError("UPLOAD_CONCURRENCY_LIMIT", 429);
				const reservationId = randomUUID(),
					path = `${id}/${reservationId}/source`;
				await db.query(
					"insert into pm.upload_reservations(id,project_id,actor_key,share_id,filename,extension,declared_mime,byte_size,sha256,reserved_bytes,quarantine_key,purpose) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
					[
						reservationId,
						id,
						actorKey(actor),
						shareId,
						input.filename,
						policy.ext,
						input.declaredMime,
						input.byteSize,
						input.sha256,
						policy.budget,
						path,
						purpose,
					],
				);
				await db.query(
					"update pm.owner_usage set reserved_bytes=reserved_bytes+$2 where owner_id=$1",
					[ownerId, policy.budget],
				);
				await audit(db, actor, id, "upload.reserve", reservationId);
				return { id: reservationId, duplicate: false };
			},
		);
	});
}
export async function reservation(
	actor: Actor,
	id: string,
	reservationId: string,
) {
	return transaction(actor, async (db) => {
		await access(db, actor, id, false, true);
		const { rows } = await db.query(
			"select * from pm.upload_reservations where id=$1 and project_id=$2",
			[reservationId, id],
		);
		const r = rows[0];
		if (!r || (r.actor_key !== actorKey(actor) && actor.kind !== "owner"))
			throw new AppError("NOT_FOUND", 404);

		return {
			id: r.id as string,
			state: r.state as string,
			errorCode: (r.state === "processing" && (!r.processing_until || new Date(r.processing_until).getTime() < Date.now()) ? "PROCESSING_EXPIRED" : r.error_code) as string | null,
			path: r.quarantine_key as string,
			grantExpiresAt: r.grant_expires_at as string,
			cleanupAfter: r.cleanup_after as string,
		};
	});
}
export async function listReservations(
	actor: Actor,
	id: string,
	purpose: "material" | "delivery" = "material",
) {
	if (purpose === "delivery" && actor.kind !== "owner")
		throw new AppError("FORBIDDEN", 403);
	return transaction(actor, async (db) => {
		await access(db, actor, id, false, true);
		const { rows } = await db.query(
				"select id,filename,state,(actor_key=$3) as \"canProcess\",case when state='processing' and (processing_until is null or processing_until<now()) then 'PROCESSING_EXPIRED' else error_code end as \"errorCode\",coalesce(processing_until>now(),false) as \"processingActive\" from pm.upload_reservations where project_id=$1 and ($2::boolean or actor_key=$3) and purpose=$4 and state not in ('ready','cleaned') and created_at>now()-interval '1 day' order by created_at desc limit 30",
			[id, actor.kind === "owner", actorKey(actor), purpose],
		);
		return { items: rows };
	});
}
export async function files(
	actor: Actor,
	id: string,
	cursor: string | null,
	purpose: "material" | "delivery" = "material",
	filters: FileFilters = defaultFileFilters,
) {
	if (purpose === "delivery" && actor.kind !== "owner")
		throw new AppError("FORBIDDEN", 403);
	const { type, sort } = fileFiltersSchema.parse(filters);
	const scope = cursorScope(["files-v2", actorKey(actor), id, purpose, type, sort]);
	const anchor = cursorId(cursor, scope, type === "all" && sort === "created-desc");
	const typeClause = `($5='all' or ($5='image' and mime like 'image/%') or ($5='pdf' and extension='pdf') or ($5='zip' and extension='zip') or ($5='cad' and extension in ('step','stp','sldprt','sldasm','stl','dxf','dwg')))`;
	const visible = `project_id=$1 and deleted_at is null and ($2::boolean or visibility='customer') and purpose=$4 and ${typeClause}`;
	const keyColumns = sort === "name-asc" ? 'lower(filename) collate "C",id' : "created_at,id";
	const order = sort === "name-asc" ? 'lower(filename) collate "C" asc,id asc' : sort === "created-asc" ? "created_at asc,id asc" : "created_at desc,id desc";
	const compare = sort === "created-desc" ? "<" : ">";
	return transaction(actor, async (db) => {
		await access(db, actor, id, false, true);
		const params = [id, actor.kind === "owner", anchor, purpose, type];
		if (anchor && !(await db.query(`select id from pm.file_assets where ${visible} and id=$3::uuid`, params)).rows[0]) throw new AppError("CURSOR_INVALID", 422);
		const { rows } = await db.query(
			`select id,filename,mime,extension,byte_size as "byteSize",width,height,uploader_type as "uploaderType",created_at as "createdAt",
			 case when mime='image/webp' and purpose='material' then sha256||':n'||normalization_version::text else null end as "previewVersion",
			 (select jsonb_build_object('version',d.sha256,'width',d.width,'height',d.height) from pm.image_derivatives d where d.file_id=pm.file_assets.id and d.variant=640) as thumbnail,
			 case when mime='image/webp' and purpose='material' then (
			 select jsonb_build_object('version',md5(coalesce(string_agg(a.id::text||':'||a.revision::text||':'||(a.deleted_at is not null)::text,',' order by a.id),'')),
			 'count',count(*) filter(where a.deleted_at is null)) from pm.annotations a where a.project_id=pm.file_assets.project_id and a.file_id=pm.file_assets.id
			 ) else null end as "annotationSummary" from pm.file_assets
   where ${visible} and ($3::uuid is null or (${keyColumns})${compare}(select ${keyColumns} from pm.file_assets where id=$3 and project_id=$1)) order by ${order} limit 31`,
			params,
		);
		return {
			items: rows.slice(0, 30),
			nextCursor: rows.length > 30 ? queryCursor(rows[29].id, scope) : null,
		};
	});
}
export async function fileForRead(
	actor: Actor,
	id: string,
	fileId: string,
	original = false,
	variant: number | null = null,
) {
	return transaction(actor, async (db) => {
		await access(db, actor, id, false, true);
		if (original && actor.kind !== "owner")
			throw new AppError("FORBIDDEN", 403);
		const { rows } = await db.query(
			"select f.*,t.storage_key as thumbnail_key,t.byte_size as thumbnail_bytes,t.sha256 as thumbnail_hash from pm.file_assets f left join pm.image_derivatives t on t.file_id=f.id and t.project_id=f.project_id and t.image_hash=f.sha256 and t.variant=$4 where f.id=$1 and f.project_id=$2 and f.deleted_at is null and ($3::boolean or (f.visibility='customer' and (f.purpose='material' or exists(select 1 from pm.delivery_files a join pm.deliveries d on d.id=a.delivery_id and d.project_id=a.project_id where a.file_id=f.id and a.project_id=f.project_id and a.selected and d.state='published'))))",
			[fileId, id, actor.kind === "owner",variant],
		);
		if (!rows[0]) throw new AppError("NOT_FOUND", 404);
		rows[0].image_cache_scope = imageCacheScope(actor, id);
		if (variant !== null) {
			if (original || rows[0].purpose !== "material" || ![320,640].includes(variant)) throw new AppError("INVALID_INPUT",422);
			if (!rows[0].thumbnail_key) throw new AppError("IMAGE_NOT_READY",409);
			return {...rows[0],storage_key:rows[0].thumbnail_key,byte_size:rows[0].thumbnail_bytes,sha256:rows[0].thumbnail_hash};
		}
		return rows[0];
	});
}
/** Fresh batch authorization only. No Storage signatures or reusable access tokens. */
export async function imageAccess(actor: Actor, projectId: string, ids: string[]): Promise<ImageAccess> {
	if (!ids.length || ids.length > 30 || new Set(ids).size !== ids.length) throw new AppError("INVALID_INPUT", 422);
	return transaction(actor, async db => {
		await access(db, actor, projectId, false, true);
		const { rows } = await db.query<{ id: string; images: ImageAccess["items"][number]["images"] }>(`select f.id,
		 jsonb_build_array(jsonb_build_object('variant',null,'version',f.sha256,'bytes',f.byte_size)) ||
		 coalesce((select jsonb_agg(jsonb_build_object('variant',d.variant,'version',d.sha256,'bytes',d.byte_size) order by d.variant) from pm.image_derivatives d where d.project_id=f.project_id and d.file_id=f.id and d.image_hash=f.sha256),'[]'::jsonb) images
		 from pm.file_assets f where f.project_id=$1 and f.id=any($2::uuid[]) and f.deleted_at is null and f.mime='image/webp'
		 and ($3::boolean or (f.visibility='customer' and (f.purpose='material' or exists(select 1 from pm.delivery_files a join pm.deliveries d on d.project_id=a.project_id and d.id=a.delivery_id where a.project_id=f.project_id and a.file_id=f.id and a.selected and d.state='published'))))`, [projectId, ids, actor.kind === "owner"]);
		// A deleted/hidden file must not block other authorized photos in the same visible batch.
		if (!rows.length) throw new AppError("NOT_FOUND", 404);
		const namespace = imageCacheScope(actor, projectId);
		if (!namespace) throw new AppError("STORAGE_NOT_CONFIGURED", 503);
		return { namespace, items: rows };
	});
}
export async function deleteFile(
	actor: Actor,
	id: string,
	fileId: string,
	key: string,
) {
	return transaction(actor, async (db) => {
		await access(db, actor, id, true);
		return idempotent(
			db,
			`${id}:${actorKey(actor)}:delete`,
			key,
			{ fileId },
			async () => {
				const { rows } = await db.query(
					"select history_protected from pm.file_assets where id=$1 and project_id=$2 for update",
					[fileId, id],
				);
				if (!rows[0]) throw new AppError("NOT_FOUND", 404);
				if (rows[0].history_protected)
					throw new AppError("HISTORY_PROTECTED", 409);
				await db.query(
					"update pm.file_assets set deleted_at=coalesce(deleted_at,now()) where id=$1 and project_id=$2",
					[fileId, id],
				);
				await audit(db, actor, id, "file.hide", fileId);
				return { deleted: true };
			},
		);
	});
}
