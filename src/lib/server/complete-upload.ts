import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError, imageExtensions, sniff, uploadPolicy } from "../policy";
import { type Actor, transaction, rate } from "./db";
import { access, actorKey, audit } from "./service";
import { privateBucket, quarantine, storage } from "./storage";
import { effectiveFileLimit } from "./file-limits";

export const validationPolicy = "format-only-v2";
// Resolve at runtime so Next's file tracer cannot walk the OS temp/browser cache tree.
const uploadTempRoot = () => Reflect.apply(tmpdir, undefined, []) as string;
type Upload = {
	id: string; project_id: string; filename: string; extension: string; declared_mime: string;
	byte_size: string; sha256: string; quarantine_key: string; purpose: "material" | "delivery";
	actor_key: string; share_id: string | null; state: string; processing_token: string | null;
	processing_until: Date | null; reserved_bytes: string;
};
type Prepared = { bytes: number; hash: string; originalKey: string; key: string; mime: string;
	width: number | null; height: number | null; normalizationVersion: number | null;
	thumbnails: { variant: number; width: number; height: number; bytes: number; hash: string; key: string }[] };

export async function claimUpload(actor: Actor, projectId: string, id: string) {
	return transaction(actor, async (db) => {
		await rate(db, `complete:${actorKey(actor)}`, 30);
		await access(db, actor, projectId);
		const r = (await db.query<Upload & { upload_expired: boolean; active: boolean }>(
			"select *,created_at<now()-interval '15 minutes' as upload_expired,processing_until>now() as active from pm.upload_reservations where id=$1 and project_id=$2 for update", [id, projectId],
		)).rows[0];
		if (!r || r.actor_key !== actorKey(actor)) throw new AppError("NOT_FOUND", 404);
		if (r.state === "ready") return { ready: true as const, upload: r };
		if (["rejected", "cleaned"].includes(r.state)) throw new AppError("FILE_REJECTED", 422);
		if (r.state === "reserved" && r.upload_expired) throw new AppError("UPLOAD_WINDOW_EXPIRED", 409);
		if (r.active) throw new AppError("PROCESSING_ACTIVE", 409);
		const legacy = await db.query("select id from pm.jobs where reservation_id=$1 and lease_until>now() and done_at is null", [id]);
		if (legacy.rowCount) throw new AppError("PROCESSING_ACTIVE", 409);
		const token = randomUUID();
		await db.query("update pm.upload_reservations set state='processing',processing_token=$2,processing_until=now()+interval '60 seconds',error_code=null where id=$1", [id, token]);
		await db.query("update pm.jobs set done_at=now(),lease_until=null,error_code='REQUEST_PROCESSING_TAKEOVER' where reservation_id=$1 and done_at is null", [id]);
		return { ready: false as const, upload: { ...r, processing_token: token } };
	});
}

// This verifier runs once over a bounded stream, independently of transport declarations.
export async function verifySource(response: Response, target: string, upload: Pick<Upload, "byte_size" | "sha256" | "filename" | "extension" | "declared_mime">, signal?: AbortSignal) {
	if (!response.ok || !response.body) throw new AppError("UPLOAD_OBJECT_NOT_FOUND", 503);
	const expected = Number(upload.byte_size);
	if (expected > effectiveFileLimit()) throw new AppError("FILE_TOO_LARGE", 413);
	uploadPolicy(upload.filename, expected, upload.declared_mime);
	let received = 0;
	const hash = createHash("sha256");
	await pipeline(response.body, new Transform({ transform(chunk, _enc, callback) {
		received += chunk.length;
		if (received > expected) return callback(new AppError("HASH_OR_SIZE_MISMATCH", 422));
		hash.update(chunk); callback(null, chunk);
	} }), createWriteStream(target, { flags: "wx" }), { signal });
	if (received !== expected || hash.digest("hex") !== upload.sha256) throw new AppError("HASH_OR_SIZE_MISMATCH", 422);
	sniff(await readFile(target), upload.extension);
}

async function put(key: string, file: string, mime: string, signal: AbortSignal) {
	signal.throwIfAborted();
	const bytes = await readFile(file);
	const result = await storage(signal).from(privateBucket).upload(key, bytes, { contentType: mime, upsert: false });
	if (!result.error) return;
	if (!["409", "400"].includes(String(result.error.statusCode)) ||
		(String(result.error.statusCode) === "400" && !/duplicate|already exists/i.test(result.error.message)))
		throw new AppError("STORAGE_UNAVAILABLE", 503);
	const existing = await storage(signal).from(privateBucket).download(key);
	if (existing.error || !existing.data) throw new AppError("STORAGE_UNAVAILABLE", 503);
	const previous = Buffer.from(await existing.data.arrayBuffer());
	if (!createHash("sha256").update(previous).digest().equals(createHash("sha256").update(bytes).digest()))
		throw new AppError("IMMUTABLE_OBJECT_CONFLICT", 422);
}

export async function finalizeUpload(actor: Actor, upload: Upload, prepared: Prepared) {
	return transaction(actor, async (db) => {
		const owner = (await db.query("select owner_id from pm.projects where id=$1", [upload.project_id])).rows[0];
		if (!owner) throw new AppError(actor.kind === "guest" ? "LINK_UNAVAILABLE" : "NOT_FOUND", actor.kind === "guest" ? 401 : 404);
		await db.query("select owner_id from pm.owner_usage where owner_id=$1 for update", [owner.owner_id]);
		await access(db, actor, upload.project_id);
		const row = (await db.query("select actor_key,state,processing_token,processing_until>now() as live from pm.upload_reservations where id=$1 and project_id=$2 for update", [upload.id, upload.project_id])).rows[0];
		if (!row || row.actor_key !== actorKey(actor)) throw new AppError("NOT_FOUND", 404);
		if (row?.state === "ready") return { id: upload.id, state: "ready" as const, validationPolicy, scanPerformed: false };
		if (row?.state !== "processing" || row.processing_token !== upload.processing_token || !row.live) throw new AppError("PROCESSING_EXPIRED", 409);
		await db.query("select set_config('pm.processing_token',$1,true)", [upload.processing_token]);
		const total = Number(upload.byte_size) + (prepared.key !== prepared.originalKey ? prepared.bytes : 0) + prepared.thumbnails.reduce((n, t) => n + t.bytes, 0);
		if (total > Number(upload.reserved_bytes)) throw new AppError("DERIVATIVE_LIMIT", 422);
		await db.query(`insert into pm.file_assets(id,project_id,reservation_id,filename,mime,extension,byte_size,original_bytes,storage_key,original_key,sha256,original_sha256,width,height,normalization_version,uploader_type,purpose,visibility,validation_policy)
 values($1,$2,$1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
		[upload.id, upload.project_id, upload.filename, prepared.mime, upload.extension, prepared.bytes, upload.byte_size,
			prepared.key, prepared.originalKey, prepared.hash, upload.sha256, prepared.width, prepared.height,
			prepared.normalizationVersion, upload.share_id ? "guest" : "owner", upload.purpose, upload.purpose === "delivery" ? "internal" : "customer", validationPolicy]);
		for (const t of prepared.thumbnails) await db.query(`insert into pm.image_derivatives(project_id,file_id,variant,storage_key,sha256,image_hash,byte_size,width,height) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			[upload.project_id, upload.id, t.variant, t.key, t.hash, prepared.hash, t.bytes, t.width, t.height]);
		await db.query("update pm.projects set used_bytes=used_bytes+$2 where id=$1", [upload.project_id, total]);
		await db.query("update pm.owner_usage set used_bytes=used_bytes+$2,reserved_bytes=reserved_bytes-$3 where owner_id=$1", [owner.owner_id, total, upload.reserved_bytes]);
		await db.query("update pm.upload_reservations set state='ready',error_code=null,processing_token=null,processing_until=null where id=$1", [upload.id]);
		await audit(db, actor, upload.project_id, "file.ready.format-only-v2", upload.id);
		return { id: upload.id, state: "ready" as const, validationPolicy, scanPerformed: false };
	});
}

let running = false;
export async function completeUpload(actor: Actor, projectId: string, id: string, signal?: AbortSignal) {
	const claim = await claimUpload(actor, projectId, id);
	if (claim.ready) return { id, state: "ready", validationPolicy: "recorded", scanPerformed: null };
	const upload = claim.upload;
	let directory: string | undefined, acquired = false;
	try {
		if (running) throw new AppError("PROCESSING_BUSY", 409);
		running = true; acquired = true;
		const deadline = AbortSignal.any([AbortSignal.timeout(45000), ...(signal ? [signal] : [])]);
		directory = await mkdtemp(path.join(uploadTempRoot(), "pm-request-upload-"));
		const source = path.join(directory, "source"), canonical = path.join(directory, "canonical");
		const signed = await storage(deadline).from(quarantine).createSignedUrl(upload.quarantine_key, 60);
		if (signed.error || !signed.data) throw new AppError("UPLOAD_OBJECT_NOT_FOUND", 503);
		await verifySource(await fetch(signed.data.signedUrl, { signal: deadline, cache: "no-store" }), source, upload, deadline);
		deadline.throwIfAborted();
		const image = imageExtensions.has(upload.extension);
		let meta = null;
		if (image) {
			const { normalizeImage } = await import("../image-normalization");
			try { meta = await normalizeImage(source, canonical, upload.purpose === "delivery" ? "canonical-only" : "all"); }
			catch (e) { if (e instanceof AppError) throw e; throw new AppError("INVALID_IMAGE", 422); }
		}
		deadline.throwIfAborted();
		const originalKey = `${projectId}/${id}/source`, key = image ? `${projectId}/${id}/canonical.webp` : originalKey;
		const mime = image ? "image/webp" : upload.extension === "pdf" ? "application/pdf" : "application/octet-stream";
		const thumbnails = [];
		for (const t of meta?.thumbnails ?? []) {
			const file = `${canonical}.${t.variant}.webp`, thumbKey = `${projectId}/${id}/thumb-${t.variant}.webp`;
			thumbnails.push({ ...t, key: thumbKey, hash: createHash("sha256").update(await readFile(file)).digest("hex") });
		}
		// Independent immutable objects share one bounded network round instead of four serial uploads.
		const stored = await Promise.allSettled([
			put(originalKey, source, "application/octet-stream", deadline),
			...(image ? [put(key, canonical, mime, deadline)] : []),
			...thumbnails.map(t => put(t.key, `${canonical}.${t.variant}.webp`, "image/webp", deadline)),
		]);
		for (const result of stored) if (result.status === "rejected") throw result.reason;
		deadline.throwIfAborted();
		const output = image ? canonical : source;
		return await finalizeUpload(actor, upload, { originalKey, key, mime, thumbnails,
			bytes: (await stat(output)).size, hash: image ? createHash("sha256").update(await readFile(output)).digest("hex") : upload.sha256,
			width: meta?.width ?? null, height: meta?.height ?? null, normalizationVersion: meta?.normalizationVersion ?? null });
	} catch (e) {
		const code = e instanceof AppError ? e.code : "PROCESSING_INTERRUPTED";
		// Leave a retryable, truthful state. An expired/foreign fence cannot change a newer attempt.
		await transaction(actor, async (db) => {
			await access(db, actor, projectId);
			await db.query("update pm.upload_reservations set state=$3,error_code=$4,processing_token=null,processing_until=null where id=$1 and processing_token=$2 and state='processing'",
				[id, upload.processing_token, e instanceof AppError && [413, 415, 422].includes(e.status) ? "rejected" : "queued", code]);
		}).catch(() => {});
		throw e instanceof AppError ? e : new AppError(code, 503);
	} finally {
		if (acquired) running = false;
		if (directory && path.dirname(path.resolve(directory)) === path.resolve(uploadTempRoot()) && path.basename(directory).startsWith("pm-request-upload-"))
			await rm(directory, { recursive: true, force: true }).catch(() => {});
	}
}
