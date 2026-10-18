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
import {
	AppError,
	imageExtensions,
	sniff,
	uploadPolicy,
} from "../../src/lib/policy";
import { transaction } from "../../src/lib/server/db";
import {
	privateBucket,
	quarantine,
	storage,
} from "../../src/lib/server/storage";

const workerTx = <T>(work: Parameters<typeof transaction<T>>[1]) =>
	transaction(null, work, true);
const code = (error: unknown) =>
	error instanceof AppError
		? error.code
		: /^[0-9A-Z]{5}$/.test((error as { code?: string }).code ?? "")
			? `PG_${(error as { code: string }).code}`
			: "WORKER_DEPENDENCY_UNAVAILABLE";
async function normalize(source: string, target: string) {
	return new Promise<{
		width: number;
		height: number;
		mime: string;
		normalizationVersion: number;
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
async function put(key: string, file: string, mime: string) {
	const bytes = await readFile(file);
	const result = await storage()
		.from(privateBucket)
		.upload(key, bytes, { contentType: mime, upsert: false });
	if (result.error) {
		// A crash after upload can leave an immutable object: prove byte identity before reusing it.
		const existing = await storage().from(privateBucket).download(key);
		if (existing.error || !existing.data)
			throw new AppError("STORAGE_UNAVAILABLE", 503);
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
			`select j.id,j.reservation_id from pm.jobs j where j.done_at is null and j.dead_at is null and j.next_at<=now() and (j.lease_until is null or j.lease_until<now()) order by j.next_at for update skip locked limit 1`,
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
		const reservation = await db.query(
			"select * from pm.upload_reservations where id=$1",
			[rows[0].reservation_id],
		);
		return { ...reservation.rows[0], jobId: rows[0].id as string, lease };
	});
	if (!job) return false;
	const directory = await mkdtemp(path.join(tmpdir(), "partmeasure-"));
	try {
		if (
			job.state === "ready" ||
			job.state === "cleaned" ||
			job.state === "rejected"
		) {
			await workerTx((db) =>
				db.query(
					"update pm.jobs set done_at=now() where id=$1 and lease_token=$2",
					[job.jobId, job.lease],
				),
			);
			return true;
		}
		const source = path.join(directory, "source"),
			canonical = path.join(directory, "canonical");
		const { data, error } = await storage()
			.from(quarantine)
			.createSignedUrl(job.quarantine_key, 60);
		if (error || !data) throw new AppError("UPLOAD_OBJECT_NOT_FOUND", 503);
		const fetched = await fetch(data.signedUrl, {
			cache: "no-store",
			signal: AbortSignal.timeout(60000),
		});
		if (!fetched.ok || !fetched.body)
			throw new AppError("UPLOAD_OBJECT_NOT_FOUND", 503);
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
		const meta = image ? await normalize(source, canonical) : null;
		const originalKey = `${job.project_id}/${job.id}/source`,
			canonicalKey = image
				? `${job.project_id}/${job.id}/canonical.webp`
				: originalKey;
		const mime =
			meta?.mime ??
			(job.extension === "pdf"
				? "application/pdf"
				: "application/octet-stream");
		const originalMime = image
			? ({
					jpg: "image/jpeg",
					jpeg: "image/jpeg",
					png: "image/png",
					webp: "image/webp",
				}[job.extension as "jpg"] ?? "application/octet-stream")
			: mime;
		await put(originalKey, source, originalMime);
		if (image) await put(canonicalKey, canonical, mime);
		const output = image ? canonical : source;
		const bytes = (await stat(output)).size;
		if (bytes > effectiveFileLimit())
			throw new AppError("DERIVATIVE_LIMIT", 422);
		const canonicalHash = createHash("sha256")
			.update(await readFile(output))
			.digest("hex");
		await workerTx(async (db) => {
			const { rows: owners } = await db.query(
				"select owner_id from pm.projects where id=$1",
				[job.project_id],
			);
			const ownerId = owners[0].owner_id;
			await db.query(
				"select owner_id from pm.owner_usage where owner_id=$1 for update",
				[ownerId],
			);
			await db.query("select id from pm.projects where id=$1 for update", [
				job.project_id,
			]);
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
			const total = received + (image ? bytes : 0);
			if (total > Number(job.reserved_bytes))
				throw new AppError("DERIVATIVE_LIMIT", 422);
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
			await db.query(
				"update pm.projects set used_bytes=used_bytes+$2 where id=$1",
				[job.project_id, total],
			);
			await db.query(
				"update pm.owner_usage set used_bytes=used_bytes+$2,reserved_bytes=reserved_bytes-$3 where owner_id=$1",
				[ownerId, total, job.reserved_bytes],
			);
			await db.query(
				"update pm.upload_reservations set state='ready',error_code=null where id=$1",
				[job.id],
			);
			await db.query(
				"update pm.jobs set done_at=now(),lease_until=null where id=$1",
				[job.jobId],
			);
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
		await rm(directory, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 200,
		});
	}
	return true;
}
async function removeVerified(bucket: string, keys: string[]) {
	const result = await storage().from(bucket).remove(keys);
	if (result.error) throw new AppError("CLEANUP_DELETE_FAILED", 503);
	for (const key of keys) {
		const folder = key.slice(0, key.lastIndexOf("/")),
			name = key.slice(key.lastIndexOf("/") + 1);
		const check = await storage()
			.from(bucket)
			.list(folder, { search: name, limit: 100 });
		if (check.error || check.data.some((x) => x.name === name))
			throw new AppError("CLEANUP_UNCONFIRMED", 503);
	}
}
export async function cleanup() {
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
				await db.query(
					"select owner_id from pm.owner_usage where owner_id=$1 for update",
					[r.owner_id],
				);
				await db.query("select id from pm.projects where id=$1 for update", [
					r.project_id,
				]);
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
			]);
			await workerTx(async (db) => {
				await db.query(
					"select owner_id from pm.owner_usage where owner_id=$1 for update",
					[r.owner_id],
				);
				await db.query("select id from pm.projects where id=$1 for update", [
					r.project_id,
				]);
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
			db.query(
				"update pm.upload_reservations set quarantine_cleaned_at=now() where id=$1",
				[r.id],
			),
		);
	}
}
async function main() {
	let lastSweep = 0;
	let failures = 0;
	do {
		try {
			if (Date.now() - lastSweep > 900000) {
				try {
					await cleanup();
					lastSweep = Date.now();
				} catch (error) {
					if (
						process.argv.includes("--cleanup-only") ||
						process.argv.includes("--once")
					)
						throw error;
					lastSweep = Date.now() - 840000;
					process.stderr.write(
						`${JSON.stringify({ event: "worker_cleanup_retry", code: code(error), retryInSeconds: 60 })}\n`,
					);
				}
			}
			if (process.argv.includes("--cleanup-only")) return;
			const worked = await processOne();
			failures = 0;
			if (process.argv.includes("--once")) break;
			if (!worked) await new Promise((resolve) => setTimeout(resolve, 2000));
		} catch (error) {
			if (
				process.argv.includes("--once") ||
				process.argv.includes("--cleanup-only") ||
				(error instanceof AppError &&
					["DATABASE_NOT_CONFIGURED", "UNSAFE_DATABASE_ROLE"].includes(
						error.code,
					))
			)
				throw error;
			failures++;
			const delay = Math.min(30, 2 ** Math.min(failures, 5));
			process.stderr.write(
				`${JSON.stringify({ event: "worker_iteration_retry", code: code(error), retryInSeconds: delay })}\n`,
			);
			await new Promise((resolve) => setTimeout(resolve, delay * 1000));
		}
	} while (!process.argv.includes("--once"));
}
main().catch(() => {
	process.stderr.write("WORKER_FAILED (details redacted)\n");
	process.exitCode = 1;
});
