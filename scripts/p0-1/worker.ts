import { scan } from "../../src/lib/server/scanner";
import { effectiveFileLimit } from "../../src/lib/server/file-limits";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { AppError, limits, imageExtensions, sniff, uploadPolicy } from "../../src/lib/policy";
import { getPool, transaction } from "../../src/lib/server/db";
import { SessionNotifications } from "../../src/lib/server/session-notifications";
import { privateBucket, quarantine, storage } from "../../src/lib/server/storage";

// Archived SQL cleanup fixture only. Never start the former cloud consumer.
if (process.env.PM_EVENTS_LOCAL !== "disposable-native-pg" ||
	new URL(process.env.WORKER_DATABASE_URL ?? "http://invalid").hostname !== "127.0.0.1")
	throw Error("WORKER_RETIRED_USE_REQUEST_UPLOADS");

const workerTx = <T>(work: Parameters<typeof transaction<T>>[1]) =>
	transaction(null, work, true);
function leaseHeartbeat(table: "jobs" | "thumbnail_jobs", id: string, lease: string) {
	const abort = new AbortController();
	let busy = false;
	const timer = setInterval(() => {
		if (busy) return;
		busy = true;
		const key = table === "jobs" ? "id" : "file_id";
		const state =
			table === "jobs" ? "done_at is null and dead_at is null" : "state='processing'";
		void workerTx((db) =>
			db.query(
				`update pm.${table} set lease_until=now()+interval '5 minutes' where ${key}=$1 and lease_token=$2 and lease_until>now() and ${state} returning ${key}`,
				[id, lease],
			),
		)
			.then((r) => {
				if (!r.rowCount) abort.abort();
			})
			.catch(() => abort.abort())
			.finally(() => {
				busy = false;
			});
	}, 60000);
	return { signal: abort.signal, stop: () => clearInterval(timer) };
}
async function removeTemp(directory: string) {
	const resolved = path.resolve(directory),
		root = path.resolve(tmpdir());
	if (
		path.dirname(resolved) !== root ||
		!/^partmeasure-|^pm-thumbnails-/.test(path.basename(resolved))
	)
		throw Error("UNSAFE_TEMP_PATH");
	await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
const code = (error: unknown) =>
	error instanceof AppError
		? error.code
		: /^[0-9A-Z]{5}$/.test((error as { code?: string }).code ?? "")
			? `PG_${(error as { code: string }).code}`
			: "WORKER_DEPENDENCY_UNAVAILABLE";
async function normalize(
	source: string,
	target: string,
	mode: "all" | "thumbnails-only" | "canonical-only" = "all",
) {
	return new Promise<{
		width: number;
		height: number;
		mime: string;
		normalizationVersion: number;
		thumbnails: { variant: number; width: number; height: number; bytes: number }[];
	}>((resolve, reject) => {
		// No application secrets are inherited by the untrusted-image decoder process.
		const child = spawn(
			process.execPath,
			[
				"--max-old-space-size=512",
				"--import",
				"tsx",
				path.resolve("scripts/p0-1/image-process.ts"),
				source,
				target,
				...(mode !== "all" ? [mode] : []),
			],
			{
				env: {
					NODE_ENV: "production",
					PATH: process.env.PATH ?? "",
					SystemRoot: process.env.SystemRoot ?? "",
					TEMP: process.env.TEMP ?? tmpdir(),
				},
				stdio: ["ignore", "pipe", "ignore"],
				windowsHide: true,
			},
		);
		const timeout = setTimeout(() => {
			child.kill();
			reject(new AppError("IMAGE_TIMEOUT", 422));
		}, 30000);
		let output = "";
		child.stdout.on("data", (bytes) => {
			output += bytes.toString();
			if (output.length > 4096) child.kill();
		});
		child.on("error", () => {
			clearTimeout(timeout);
			reject(new AppError("IMAGE_PROCESS_FAILED", 503));
		});
		child.on("close", (exit) => {
			clearTimeout(timeout);
			try {
				if (exit !== 0) throw new Error();
				resolve(JSON.parse(output));
			} catch {
				reject(new AppError("INVALID_IMAGE", 422));
			}
		});
	});
}
async function put(key: string, file: string, mime: string, signal?: AbortSignal) {
	const bytes = await readFile(file);
	signal?.throwIfAborted();
	const result = await storage(signal)
		.from(privateBucket)
		.upload(key, bytes, { contentType: mime, upsert: false });
	if (result.error) {
		if (
			result.error.statusCode !== "409" &&
			!(
				result.error.statusCode === "400" &&
				/duplicate|already exists/i.test(result.error.message)
			)
		)
			throw new AppError("STORAGE_UNAVAILABLE", 503);
		// A crash after upload can leave an immutable object: prove byte identity before reusing it.
		const existing = await storage(signal).from(privateBucket).download(key);
		if (existing.error || !existing.data) throw new AppError("STORAGE_UNAVAILABLE", 503);
		const received = Buffer.from(await existing.data.arrayBuffer());
		if (
			!createHash("sha256")
				.update(received)
				.digest()
				.equals(createHash("sha256").update(bytes).digest())
		)
			throw new AppError("IMMUTABLE_OBJECT_CONFLICT", 422);
	}
}
async function processOne() {
	const job = await workerTx(async (db) => {
		const { rows } = await db.query(
			`select j.id,j.reservation_id from pm.jobs j join pm.upload_reservations r on r.id=j.reservation_id where j.done_at is null and j.dead_at is null and j.next_at<=now() and (j.lease_until is null or j.lease_until<now()) order by case when j.next_at<now()-interval '60 seconds' then 0 when r.extension in ('jpg','jpeg','png','webp') and r.byte_size<=5242880 then 1 else 2 end,j.next_at for update of j skip locked limit 1`,
		);
		if (!rows[0]) return null;
		const lease = randomUUID();
		await db.query(
			"update pm.jobs set attempts=attempts+1,lease_until=now()+interval '5 minutes',lease_token=$2 where id=$1",
			[rows[0].id, lease],
		);
		await db.query(
			"update pm.upload_reservations set state='processing' where id=$1 and state='queued'",
			[rows[0].reservation_id],
		);
		const reservation = await db.query("select * from pm.upload_reservations where id=$1", [
			rows[0].reservation_id,
		]);
		return { ...reservation.rows[0], jobId: rows[0].id as string, lease };
	});
	if (!job) return false;
	const directory = await mkdtemp(path.join(tmpdir(), "partmeasure-"));
	const leaseGuard = leaseHeartbeat("jobs", job.jobId, job.lease);
	try {
		if (job.state === "ready" || job.state === "cleaned" || job.state === "rejected") {
			await workerTx((db) =>
				db.query("update pm.jobs set done_at=now() where id=$1 and lease_token=$2", [
					job.jobId,
					job.lease,
				]),
			);
			return true;
		}
		const source = path.join(directory, "source"),
			canonical = path.join(directory, "canonical");
		const { data, error } = await storage(leaseGuard.signal)
			.from(quarantine)
			.createSignedUrl(job.quarantine_key, 60);
		if (error || !data) throw new AppError("UPLOAD_OBJECT_NOT_FOUND", 503);
		const fetched = await fetch(data.signedUrl, {
			cache: "no-store",
			signal: AbortSignal.any([leaseGuard.signal, AbortSignal.timeout(60000)]),
		});
		if (!fetched.ok || !fetched.body) throw new AppError("UPLOAD_OBJECT_NOT_FOUND", 503);
		let received = 0;
		const hash = createHash("sha256");
		await pipeline(
			fetched.body,
			new Transform({
				transform(chunk, _enc, callback) {
					received += chunk.length;
					if (received > Number(job.byte_size)) {
						callback(new AppError("BYTE_SIZE_MISMATCH", 422));
						return;
					}
					hash.update(chunk);
					callback(null, chunk);
				},
			}),
			createWriteStream(source, { flags: "wx" }),
		);
		if (received !== Number(job.byte_size) || hash.digest("hex") !== job.sha256)
			throw new AppError("HASH_OR_SIZE_MISMATCH", 422);
		uploadPolicy(job.filename, received, job.declared_mime);
		sniff(await readFile(source), job.extension);
		await scan(source);
		const image = imageExtensions.has(job.extension);
		const meta = image
			? await normalize(
					source,
					canonical,
					job.purpose === "delivery" ? "canonical-only" : "all",
				)
			: null;
		const originalKey = `${job.project_id}/${job.id}/source`,
			canonicalKey = image ? `${job.project_id}/${job.id}/canonical.webp` : originalKey;
		const mime =
			meta?.mime ?? (job.extension === "pdf" ? "application/pdf" : "application/octet-stream");
		const originalMime = image
			? ({
					jpg: "image/jpeg",
					jpeg: "image/jpeg",
					png: "image/png",
					webp: "image/webp",
				}[job.extension as "jpg"] ?? "application/octet-stream")
			: mime;
		await put(originalKey, source, originalMime, leaseGuard.signal);
		if (image) await put(canonicalKey, canonical, mime, leaseGuard.signal);
		const thumbnails = image && job.purpose === "material" ? (meta?.thumbnails ?? []) : [];
		for (const thumbnail of thumbnails)
			await put(
				`${job.project_id}/${job.id}/thumb-${thumbnail.variant}.webp`,
				`${canonical}.${thumbnail.variant}.webp`,
				"image/webp",
				leaseGuard.signal,
			);
		const output = image ? canonical : source;
		const bytes = (await stat(output)).size;
		if (bytes > effectiveFileLimit()) throw new AppError("DERIVATIVE_LIMIT", 422);
		const canonicalHash = createHash("sha256")
			.update(await readFile(output))
			.digest("hex");
		await workerTx(async (db) => {
			const { rows: owners } = await db.query("select owner_id from pm.projects where id=$1", [
				job.project_id,
			]);
			const ownerId = owners[0].owner_id;
			await db.query("select owner_id from pm.owner_usage where owner_id=$1 for update", [
				ownerId,
			]);
			await db.query("select id from pm.projects where id=$1 for update", [job.project_id]);
			if (job.share_id) {
				const { rows } = await db.query(
					"select revoked_at,expires_at>now() as live from pm.share_links where id=$1 and project_id=$2 for update",
					[job.share_id, job.project_id],
				);
				const session = await db.query(
					"select id from pm.guest_sessions where token_hash=$1 and project_id=$2 and share_id=$3 and expires_at>now()",
					[job.actor_key.slice(6), job.project_id, job.share_id],
				);
				if (!rows[0]?.live || rows[0].revoked_at || !session.rows[0])
					throw new AppError("LINK_REVOKED_BEFORE_FINALIZE", 422);
			}
			const { rows } = await db.query(
				"select state from pm.upload_reservations where id=$1 for update",
				[job.id],
			);
			const lease = await db.query(
				"select id from pm.jobs where id=$1 and lease_token=$2 and lease_until>now() for update",
				[job.jobId, job.lease],
			);
			if (!lease.rows[0]) throw new AppError("LEASE_EXPIRED", 503);
			if (rows[0].state === "ready") return;
			if (rows[0].state === "cleaned" || rows[0].state === "rejected")
				throw new AppError("INVALID_STATE", 422);
			const total =
				received + (image ? bytes : 0) + thumbnails.reduce((sum, t) => sum + t.bytes, 0);
			if (total > Number(job.reserved_bytes)) throw new AppError("DERIVATIVE_LIMIT", 422);
			await db.query(
				`insert into pm.file_assets(id,project_id,reservation_id,filename,mime,extension,byte_size,original_bytes,storage_key,original_key,sha256,original_sha256,width,height,normalization_version,uploader_type,purpose,visibility)
    values($1,$2,$1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
				[
					job.id,
					job.project_id,
					job.filename,
					mime,
					job.extension,
					bytes,
					received,
					canonicalKey,
					originalKey,
					canonicalHash,
					job.sha256,
					meta?.width ?? null,
					meta?.height ?? null,
					meta?.normalizationVersion ?? null,
					job.share_id ? "guest" : "owner",
					job.purpose,
					job.purpose === "delivery" ? "internal" : "customer",
				],
			);
			for (const thumbnail of thumbnails)
				await db.query(
					`insert into pm.image_derivatives(project_id,file_id,variant,storage_key,sha256,image_hash,byte_size,width,height) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
					[
						job.project_id,
						job.id,
						thumbnail.variant,
						`${job.project_id}/${job.id}/thumb-${thumbnail.variant}.webp`,
						createHash("sha256")
							.update(await readFile(`${canonical}.${thumbnail.variant}.webp`))
							.digest("hex"),
						canonicalHash,
						thumbnail.bytes,
						thumbnail.width,
						thumbnail.height,
					],
				);
			await db.query("update pm.projects set used_bytes=used_bytes+$2 where id=$1", [
				job.project_id,
				total,
			]);
			await db.query(
				"update pm.owner_usage set used_bytes=used_bytes+$2,reserved_bytes=reserved_bytes-$3 where owner_id=$1",
				[ownerId, total, job.reserved_bytes],
			);
			await db.query(
				"update pm.upload_reservations set state='ready',error_code=null where id=$1",
				[job.id],
			);
			await db.query("update pm.jobs set done_at=now(),lease_until=null where id=$1", [
				job.jobId,
			]);
			await db.query(
				"insert into pm.audit_events(project_id,actor_type,action,object_id) values($1,'worker','file.ready',$2)",
				[job.project_id, job.id],
			);
		});
	} catch (error) {
		const rejected = error instanceof AppError && error.status === 422;
		await workerTx(async (db) => {
			const { rows } = await db.query(
				"update pm.jobs set error_code=$3,lease_until=null,next_at=now()+make_interval(mins=>least(30,attempts*attempts)),dead_at=case when attempts>=5 or $4 then now() else null end where id=$1 and lease_token=$2 returning id",
				[job.jobId, job.lease, code(error), rejected],
			);
			if (rows[0])
				await db.query(
					"update pm.upload_reservations set error_code=$2,state=case when $3 then 'rejected' else state end where id=$1 and state<>'ready'",
					[job.id, code(error), rejected],
				);
		});
	} finally {
		leaseGuard.stop();
		await removeTemp(directory);
	}
	return true;
}
async function removeVerified(bucket: string, keys: string[]) {
	const result = await storage().from(bucket).remove(keys);
	if (result.error) throw new AppError("CLEANUP_DELETE_FAILED", 503);
	for (const key of keys) {
		const folder = key.slice(0, key.lastIndexOf("/")),
			name = key.slice(key.lastIndexOf("/") + 1);
		const check = await storage().from(bucket).list(folder, { search: name, limit: 100 });
		if (check.error || check.data.some((x) => x.name === name))
			throw new AppError("CLEANUP_UNCONFIRMED", 503);
	}
}
// Legacy canonical images are immutable and already scanned. Backfill verifies their
// recorded digest, reserves quota first, and never replaces the canonical object.
async function backfillOne() {
	const candidate = await workerTx(
		async (db) =>
			(
				await db.query(
					`select t.file_id,t.project_id,p.owner_id from pm.thumbnail_jobs t join pm.projects p on p.id=t.project_id where t.state in ('queued','processing') and t.next_at<=now() and (t.lease_until is null or t.lease_until<now()) order by t.next_at limit 1`,
				)
			).rows[0],
	);
	if (!candidate) return false;
	const job = await workerTx(async (db) => {
		const usage = (
			await db.query("select * from pm.owner_usage where owner_id=$1 for update", [
				candidate.owner_id,
			])
		).rows[0];
		const project = (
			await db.query("select * from pm.projects where id=$1 for update", [candidate.project_id])
		).rows[0];
		const row = (
			await db.query(
				"select * from pm.thumbnail_jobs where file_id=$1 and state in ('queued','processing') and (lease_until is null or lease_until<now()) for update",
				[candidate.file_id],
			)
		).rows[0];
		if (!row) return null;
		const file = (
			await db.query(
				"select * from pm.file_assets where id=$1 and deleted_at is null and purpose='material' and mime='image/webp'",
				[candidate.file_id],
			)
		).rows[0];
		if (!file) {
			await db.query(
				"update pm.thumbnail_jobs set state=case when reserved_bytes>0 then 'cleanup' else 'dead' end,next_at=now()+interval '10 minutes' where file_id=$1",
				[candidate.file_id],
			);
			return null;
		}
		if (!Number(row.reserved_bytes)) {
			const pending = (
				await db.query(
					"select coalesce((select sum(reserved_bytes) from pm.upload_reservations where project_id=$1 and state not in ('ready','cleaned')),0)+coalesce((select sum(reserved_bytes) from pm.thumbnail_jobs where project_id=$1),0) as n",
					[candidate.project_id],
				)
			).rows[0].n;
			if (
				Number(project.used_bytes) + Number(pending) + 524288 > limits.project ||
				Number(usage.used_bytes) + Number(usage.reserved_bytes) + 524288 > limits.account
			) {
				await db.query(
					"update pm.thumbnail_jobs set state='dead',error_code='QUOTA_EXCEEDED' where file_id=$1",
					[candidate.file_id],
				);
				return null;
			}
			await db.query(
				"update pm.owner_usage set reserved_bytes=reserved_bytes+524288 where owner_id=$1",
				[candidate.owner_id],
			);
		}
		const lease = randomUUID();
		await db.query(
			"update pm.thumbnail_jobs set state='processing',attempts=attempts+1,reserved_bytes=524288,lease_token=$2,lease_until=now()+interval '5 minutes' where file_id=$1",
			[candidate.file_id, lease],
		);
		return { ...file, lease };
	});
	if (!job) return true;
	const directory = await mkdtemp(path.join(tmpdir(), "pm-thumbnails-"));
	const leaseGuard = leaseHeartbeat("thumbnail_jobs", job.id, job.lease);
	try {
		const signed = await storage(leaseGuard.signal)
			.from(privateBucket)
			.createSignedUrl(job.storage_key, 60);
		if (signed.error || !signed.data) throw new AppError("STORAGE_UNAVAILABLE", 503);
		const r = await fetch(signed.data.signedUrl, {
			signal: AbortSignal.any([leaseGuard.signal, AbortSignal.timeout(60000)]),
		});
		if (!r.ok || !r.body) throw new AppError("STORAGE_UNAVAILABLE", 503);
		const source = path.join(directory, "source"),
			target = path.join(directory, "thumb");
		const hash = createHash("sha256");
		let size = 0;
		await pipeline(
			r.body,
			new Transform({
				transform(chunk, _enc, done) {
					size += chunk.length;
					if (size > Number(job.byte_size))
						return done(new AppError("BYTE_SIZE_MISMATCH", 422));
					hash.update(chunk);
					done(null, chunk);
				},
			}),
			createWriteStream(source, { flags: "wx" }),
		);
		if (size !== Number(job.byte_size) || hash.digest("hex") !== job.sha256)
			throw new AppError("HASH_OR_SIZE_MISMATCH", 422);
		const meta = await normalize(source, target, "thumbnails-only");
		for (const t of meta.thumbnails)
			await put(
				`${job.project_id}/${job.id}/thumb-${t.variant}.webp`,
				`${target}.${t.variant}.webp`,
				"image/webp",
				leaseGuard.signal,
			);
		const descriptors = await Promise.all(
			meta.thumbnails.map(async (t) => ({
				...t,
				hash: createHash("sha256")
					.update(await readFile(`${target}.${t.variant}.webp`))
					.digest("hex"),
			})),
		);
		await workerTx(async (db) => {
			await db.query("select owner_id from pm.owner_usage where owner_id=$1 for update", [
				candidate.owner_id,
			]);
			await db.query("select id from pm.projects where id=$1 for update", [job.project_id]);
			const valid = await db.query(
				"select file_id from pm.thumbnail_jobs where file_id=$1 and lease_token=$2 and state='processing' and lease_until>now() for update",
				[job.id, job.lease],
			);
			const live = await db.query(
				"select id from pm.file_assets where id=$1 and deleted_at is null",
				[job.id],
			);
			if (!valid.rows[0] || !live.rows[0]) throw new AppError("THUMBNAIL_LEASE_LOST", 422);
			for (const t of descriptors)
				await db.query(
					"insert into pm.image_derivatives(project_id,file_id,variant,storage_key,sha256,image_hash,byte_size,width,height) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
					[
						job.project_id,
						job.id,
						t.variant,
						`${job.project_id}/${job.id}/thumb-${t.variant}.webp`,
						t.hash,
						job.sha256,
						t.bytes,
						t.width,
						t.height,
					],
				);
			const bytes = descriptors.reduce((n, t) => n + t.bytes, 0);
			await db.query("update pm.projects set used_bytes=used_bytes+$2 where id=$1", [
				job.project_id,
				bytes,
			]);
			await db.query(
				"update pm.owner_usage set used_bytes=used_bytes+$2,reserved_bytes=reserved_bytes-524288 where owner_id=$1",
				[candidate.owner_id, bytes],
			);
			await db.query(
				"update pm.thumbnail_jobs set state='ready',reserved_bytes=0,lease_until=null,error_code=null where file_id=$1",
				[job.id],
			);
		});
	} catch (error) {
		await workerTx((db) =>
			db.query(
				"update pm.thumbnail_jobs set error_code=$3,state=case when attempts>=5 or $4 then 'cleanup' else 'queued' end,lease_until=null,next_at=now()+case when attempts>=5 or $4 then interval '10 minutes' else interval '30 seconds' end where file_id=$1 and lease_token=$2 and state='processing'",
				[job.id, job.lease, code(error), error instanceof AppError && error.status === 422],
			),
		);
	} finally {
		leaseGuard.stop();
		await removeTemp(directory);
	}
	return true;
}

async function cleanupThumbnailsAndEvents() {
	const jobs = await workerTx(
		async (db) =>
			(
				await db.query(
					"select t.*,p.owner_id from pm.thumbnail_jobs t join pm.projects p on p.id=t.project_id where t.state='cleanup' and t.next_at<=now() and not exists(select 1 from pm.image_derivatives d where d.file_id=t.file_id) limit 50",
				)
			).rows,
	);
	for (const job of jobs) {
		await removeVerified(
			privateBucket,
			[320, 640].map((v) => `${job.project_id}/${job.file_id}/thumb-${v}.webp`),
		);
		await workerTx(async (db) => {
			await db.query("select owner_id from pm.owner_usage where owner_id=$1 for update", [
				job.owner_id,
			]);
			await db.query("select id from pm.projects where id=$1 for update", [job.project_id]);
			const cleared = await db.query(
				"update pm.thumbnail_jobs set state='dead',reserved_bytes=0 where file_id=$1 and state='cleanup' returning file_id",
				[job.file_id],
			);
			if (cleared.rows[0])
				await db.query(
					"update pm.owner_usage set reserved_bytes=reserved_bytes-$2 where owner_id=$1",
					[job.owner_id, job.reserved_bytes],
				);
		});
	}
	// Lock cursor before pruning; an active writer can never lose an uncommitted event.
	await workerTx(async (db) => {
		const projects = await db.query(
			"select project_id from pm.project_event_cursors where project_id in (select project_id from pm.project_events where created_at<now()-interval '7 days') limit 20 for update skip locked",
		);
		for (const p of projects.rows)
			await db.query(
				`with removed as (delete from pm.project_events where project_id=$1 and created_at<now()-interval '7 days' returning owner_seq,guest_seq) update pm.project_event_cursors set owner_floor=greatest(owner_floor,coalesce((select max(owner_seq) from removed),0)),guest_floor=greatest(guest_floor,coalesce((select max(guest_seq) from removed),0)) where project_id=$1`,
				[p.project_id],
			);
	});
}
export async function cleanup() {
	await cleanupThumbnailsAndEvents();
	const rows = await workerTx(
		async (db) =>
			(
				await db.query(
					`select r.*,p.owner_id from pm.upload_reservations r join pm.projects p on p.id=r.project_id where r.cleanup_after<now() and r.state not in ('ready','cleaned') and not exists(select 1 from pm.jobs j where j.reservation_id=r.id and j.lease_until>now()) limit 50`,
				)
			).rows,
	);
	for (const r of rows) {
		try {
			// Expired grants cannot add new bytes. A concurrent worker cannot publish an asset after cleanup begins.
			const claimed = await workerTx(async (db) => {
				await db.query("select owner_id from pm.owner_usage where owner_id=$1 for update", [
					r.owner_id,
				]);
				await db.query("select id from pm.projects where id=$1 for update", [r.project_id]);
				const job = await db.query(
					"select lease_until>now() as active from pm.jobs where reservation_id=$1 for update",
					[r.id],
				);
				if (job.rows[0]?.active) return false;
				const lease = randomUUID();
				const claim = await db.query(
					"update pm.upload_reservations set state='rejected',error_code='UPLOAD_EXPIRED',cleanup_token=$2,cleanup_lease_until=now()+interval '5 minutes',cleanup_attempts=cleanup_attempts+1 where id=$1 and state not in ('ready','cleaned') and cleanup_dead_at is null and (cleanup_lease_until is null or cleanup_lease_until<now()) returning id",
					[r.id, lease],
				);
				if (!claim.rows[0]) return false;
				r.cleanup_token = lease;
				await db.query(
					"update pm.jobs set dead_at=now() where reservation_id=$1 and done_at is null",
					[r.id],
				);
				return true;
			});
			if (!claimed) continue;
			await removeVerified(quarantine, [r.quarantine_key]);
			await removeVerified(privateBucket, [
				`${r.project_id}/${r.id}/source`,
				`${r.project_id}/${r.id}/canonical.webp`,
				`${r.project_id}/${r.id}/thumb-320.webp`,
				`${r.project_id}/${r.id}/thumb-640.webp`,
			]);
			await workerTx(async (db) => {
				await db.query("select owner_id from pm.owner_usage where owner_id=$1 for update", [
					r.owner_id,
				]);
				await db.query("select id from pm.projects where id=$1 for update", [r.project_id]);
				const { rowCount } = await db.query(
					"update pm.upload_reservations set state='cleaned',cleanup_lease_until=null where id=$1 and state='rejected' and cleanup_token=$2",
					[r.id, r.cleanup_token],
				);
				if (rowCount)
					await db.query(
						"update pm.owner_usage set reserved_bytes=reserved_bytes-$2 where owner_id=$1",
						[r.owner_id, r.reserved_bytes],
					);
			});
		} catch {
			await workerTx((db) =>
				db.query(
					"update pm.upload_reservations set cleanup_lease_until=now()+make_interval(mins=>least(30,cleanup_attempts*cleanup_attempts)),cleanup_dead_at=case when cleanup_attempts>=5 then now() else null end where id=$1 and cleanup_token=$2",
					[r.id, r.cleanup_token],
				),
			);
			/* Keep quota reserved. Dead-letter on fifth failure; operator queries counts, never secrets. */
		}
	}
	// Ready originals have been copied into private bucket: discard only the expired quarantine duplicate.
	const ready = await workerTx(
		async (db) =>
			(
				await db.query(
					"select id,quarantine_key from pm.upload_reservations where state='ready' and quarantine_cleaned_at is null and cleanup_after<now() limit 50",
				)
			).rows,
	);
	for (const r of ready) {
		await removeVerified(quarantine, [r.quarantine_key]);
		await workerTx((db) =>
			db.query("update pm.upload_reservations set quarantine_cleaned_at=now() where id=$1", [
				r.id,
			]),
		);
	}
}
async function main() {
	const once = process.argv.includes("--once"),
		cleanupOnly = process.argv.includes("--cleanup-only"),
		externalCleanup = process.env.PM_WORKER_EXTERNAL_CLEANUP === "1";
	if (cleanupOnly) {
		await cleanup();
		return;
	}
	const notifications = new SessionNotifications("pm_file_jobs", true);
	let wake: (() => void) | null = null,
		notified = false,
		lastSweep = 0,
		turns = 0,
		failures = 0,
		stopping = false;
	const notify = () => {
		notified = true;
		wake?.();
	};
	const shutdown = () => {
		stopping = true;
		notify();
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
	let off: (() => void) | undefined,
		listening = false;
	const listen = async () => {
		try {
			off?.();
			off = await notifications.subscribe({
				change: notify,
				dropped: () => {
					listening = false;
					notify();
				},
			});
			listening = true;
		} catch {
			listening = false;
		}
	};
	if (!once) await listen();
	try {
		do {
			try {
				if (!once && !listening) await listen();
				// Priority uploads first; every tenth turn allows an old image to progress.
				const worked = process.argv.includes("--backfill-only")
					? await backfillOne()
					: ++turns % 10 === 0
						? (await backfillOne()) || (await processOne())
						: (await processOne()) || (await backfillOne());
				failures = 0;
				// Deployment uses a separate supervised cleanup timer. Standalone mode retains cleanup.
				if (!externalCleanup && Date.now() - lastSweep > 900000) {
					await cleanup();
					lastSweep = Date.now();
				}
				if (once) break;
				if (!worked && !notified && !stopping)
					await new Promise<void>((resolve) => {
						const timer = setTimeout(resolve, 30000);
						wake = () => {
							clearTimeout(timer);
							resolve();
						};
					});
				wake = null;
				notified = false;
			} catch (error) {
				if (once) throw error;
				const delay = Math.min(30, 2 ** Math.min(++failures, 5));
				process.stderr.write(
					`${JSON.stringify({ event: "worker_iteration_retry", code: code(error), retryInSeconds: delay })}\n`,
				);
				await new Promise<void>((resolve) => {
					const timer = setTimeout(resolve, delay * 1000);
					wake = () => {
						clearTimeout(timer);
						resolve();
					};
				});
				wake = null;
			}
		} while (!stopping);
	} finally {
		off?.();
		notifications.stop();
		process.removeListener("SIGTERM", shutdown);
		process.removeListener("SIGINT", shutdown);
	}
}

main()
	.catch(() => {
		process.stderr.write("WORKER_FAILED (details redacted)\n");
		process.exitCode = 1;
	})
	.finally(async () => {
		try {
			await getPool(true).end();
		} catch {
			/* No pool was configured. */
		}
	});
