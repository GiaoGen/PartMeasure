// One-shot maintenance for the explicitly authorized isolated project. No daemon/scanner.
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseEnv } from "node:util";
import { getPool, transaction } from "../../src/lib/server/db";
import { storage, privateBucket } from "../../src/lib/server/storage";
import { normalizeImage } from "../../src/lib/image-normalization";
import { AppError, limits } from "../../src/lib/policy";

const ref = "rvysclscetfqicpnzlra";
// Reuse the original restricted maintenance credential without changing app configuration.
if (!process.env.WORKER_DATABASE_URL) {
	const previous = parseEnv(await readFile("tmp/p0-1/generated-env.local", "utf8"));
	process.env.WORKER_DATABASE_URL = previous.WORKER_DATABASE_URL;
}
for (const [name, role] of [["DATABASE_URL", "partmeasure_runtime"], ["WORKER_DATABASE_URL", "partmeasure_worker"]] as const) {
	const url = new URL(process.env[name] ?? "http://invalid");
	if (decodeURIComponent(url.username) !== `${role}.${ref}` || !url.hostname.endsWith(".pooler.supabase.com")) throw Error("ISOLATED_RESTRICTED_ROLE_ONLY");
}
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid").hostname !== `${ref}.supabase.co` || process.env.PM_NETWORK_MODE !== "direct") throw Error("ISOLATED_DIRECT_ONLY");
const apply = process.argv.includes("--apply");
const quota = 524288;
const tx = <T>(work: Parameters<typeof transaction<T>>[1]) => transaction(null, work, true);
type Candidate = { id: string; project_id: string; owner_id: string; sha256: string; byte_size: string; storage_key: string; width: number; height: number };
const report: { projectRef: string; apply: boolean; startedAt: string; candidates: number; completed: number; failed: number; derivatives: number; bytes: number; remaining?: number; canonicalHashesPreserved: boolean | null; errors: string[] } = {
	projectRef: ref, apply, startedAt: new Date().toISOString(), candidates: 0, completed: 0, failed: 0, derivatives: 0, bytes: 0, canonicalHashesPreserved: null, errors: [],
};
const safeError = (error: unknown) => error instanceof AppError ? error.code : /^[A-Z0-9_]{2,50}$/.test((error as { code?: string }).code ?? "") ? (error as { code: string }).code : "BACKFILL_FAILED";
async function removeTemp(directory: string) {
	const resolved = path.resolve(directory);
	if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("pm-thumbnails-stage2-")) throw Error("UNSAFE_TEMP_PATH");
	await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
}
const missing = `select f.id,f.project_id,p.owner_id,f.sha256,f.byte_size,f.storage_key,f.width,f.height from pm.file_assets f join pm.projects p on p.id=f.project_id
 where f.deleted_at is null and f.purpose='material' and f.mime='image/webp' and f.normalization_version=1
 and exists(select 1 from (values(320),(640)) v(n) where not exists(select 1 from pm.image_derivatives d where d.project_id=f.project_id and d.file_id=f.id and d.image_hash=f.sha256 and d.variant=v.n))`;
async function one(file: Candidate) {
	const lease = randomUUID();
	const claimed = await tx(async db => {
		const usage = (await db.query("select used_bytes,reserved_bytes from pm.owner_usage where owner_id=$1 for update", [file.owner_id])).rows[0];
		const project = (await db.query("select used_bytes from pm.projects where id=$1 for update", [file.project_id])).rows[0];
		await db.query("insert into pm.thumbnail_jobs(project_id,file_id) values($1,$2) on conflict(file_id) do nothing", [file.project_id, file.id]);
		const job = (await db.query("select *,lease_until>now() active from pm.thumbnail_jobs where project_id=$1 and file_id=$2 for update", [file.project_id, file.id])).rows[0];
		if (job.active || job.state === "cleanup") throw new AppError("BACKFILL_BUSY", 409);
		const existing = (await db.query("select variant from pm.image_derivatives where project_id=$1 and file_id=$2 and image_hash=$3", [file.project_id, file.id, file.sha256])).rows.map(r => Number(r.variant));
		const variants = [320, 640].filter(v => !existing.includes(v));
		if (!variants.length) return null;
		if (Number(job.reserved_bytes) === 0) {
			const reserved = (await db.query("select coalesce((select sum(reserved_bytes) from pm.upload_reservations where project_id=$1 and state not in ('ready','cleaned')),0)+coalesce((select sum(reserved_bytes) from pm.thumbnail_jobs where project_id=$1),0) n", [file.project_id])).rows[0].n;
			if (Number(project.used_bytes) + Number(reserved) + quota > limits.project || Number(usage.used_bytes) + Number(usage.reserved_bytes) + quota > limits.account) throw new AppError("QUOTA_EXCEEDED", 413);
			await db.query("update pm.owner_usage set reserved_bytes=reserved_bytes+$2 where owner_id=$1", [file.owner_id, quota]);
		}
		await db.query("update pm.thumbnail_jobs set state='processing',attempts=attempts+1,reserved_bytes=$3,lease_token=$2,lease_until=now()+interval '10 minutes',error_code=null where file_id=$1", [file.id, lease, quota]);
		return variants;
	});
	if (!claimed) return;
	const directory = await mkdtemp(path.join(tmpdir(), "pm-thumbnails-stage2-"));
	try {
		const deadline = AbortSignal.timeout(240000);
		const signed = await storage(deadline).from(privateBucket).createSignedUrl(file.storage_key, 60);
		if (signed.error || !signed.data) throw new AppError("STORAGE_UNAVAILABLE", 503);
		const response = await fetch(signed.data.signedUrl, { signal: AbortSignal.any([deadline, AbortSignal.timeout(60000)]), cache: "no-store" });
		if (!response.ok || !response.body || Number(file.byte_size) > limits.derivative) throw new AppError("SOURCE_UNAVAILABLE", 503);
		const source = path.join(directory, "source"), target = path.join(directory, "thumbnail");
		let bytes = 0;
		const hash = createHash("sha256");
		await pipeline(response.body, new Transform({ transform(chunk, _encoding, callback) {
			bytes += chunk.length;
			if (bytes > Number(file.byte_size)) return callback(new AppError("HASH_OR_SIZE_MISMATCH", 422));
			hash.update(chunk); callback(null, chunk);
		} }), createWriteStream(source, { flags: "wx" }));
		if (bytes !== Number(file.byte_size) || hash.digest("hex") !== file.sha256) throw new AppError("HASH_OR_SIZE_MISMATCH", 422);
		const normalized = await normalizeImage(source, target, "thumbnails-only");
		if (normalized.width !== file.width || normalized.height !== file.height) throw new AppError("IMAGE_VERSION_CONFLICT", 409);
		const descriptors: (Awaited<ReturnType<typeof normalizeImage>>["thumbnails"][number] & { sha256: string; key: string })[] = [];
		for (const thumb of normalized.thumbnails.filter(t => claimed.includes(t.variant))) {
			deadline.throwIfAborted();
			const content = await readFile(`${target}.${thumb.variant}.webp`);
			const sha256 = createHash("sha256").update(content).digest("hex");
			const key = `${file.project_id}/${file.id}/thumb-${thumb.variant}-${sha256}.webp`;
			const result = await storage(deadline).from(privateBucket).upload(key, content, { contentType: "image/webp", upsert: false });
			if (result.error) {
				if (!["400", "409"].includes(String(result.error.statusCode))) throw new AppError("STORAGE_UNAVAILABLE", 503);
				const existing = await storage(deadline).from(privateBucket).download(key);
				if (existing.error || !existing.data || createHash("sha256").update(Buffer.from(await existing.data.arrayBuffer())).digest("hex") !== sha256) throw new AppError("IMMUTABLE_OBJECT_CONFLICT", 409);
			}
			descriptors.push({ ...thumb, sha256, key });
		}
		await tx(async db => {
			await db.query("select owner_id from pm.owner_usage where owner_id=$1 for update", [file.owner_id]);
			await db.query("select id from pm.projects where id=$1 for update", [file.project_id]);
			const valid = (await db.query("select file_id from pm.thumbnail_jobs where file_id=$1 and lease_token=$2 and state='processing' and lease_until>now() for update", [file.id, lease])).rowCount;
			const live = (await db.query("select id from pm.file_assets where project_id=$1 and id=$2 and sha256=$3 and deleted_at is null", [file.project_id, file.id, file.sha256])).rowCount;
			if (!valid || !live) throw new AppError("BACKFILL_LEASE_LOST", 409);
			let total = 0, inserted = 0;
			for (const thumb of descriptors) {
				const saved = await db.query("insert into pm.image_derivatives(project_id,file_id,variant,storage_key,sha256,image_hash,byte_size,width,height) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(file_id,variant) do nothing returning file_id", [file.project_id, file.id, thumb.variant, thumb.key, thumb.sha256, file.sha256, thumb.bytes, thumb.width, thumb.height]);
				if (saved.rowCount) { total += thumb.bytes; inserted++; }
			}
			await db.query("update pm.projects set used_bytes=used_bytes+$2 where id=$1", [file.project_id, total]);
			await db.query("update pm.owner_usage set used_bytes=used_bytes+$2,reserved_bytes=reserved_bytes-$3 where owner_id=$1", [file.owner_id, total, quota]);
			await db.query("update pm.thumbnail_jobs set state='ready',reserved_bytes=0,lease_until=null,error_code=null where file_id=$1", [file.id]);
			report.bytes += total; report.derivatives += inserted;
		});
		report.completed++;
	} catch (error) {
		await tx(db => db.query("update pm.thumbnail_jobs set state='queued',lease_until=null,next_at=now(),error_code='BACKFILL_RETRY_REQUIRED' where file_id=$1 and lease_token=$2 and state='processing'", [file.id, lease]));
		throw error;
	} finally {
		await removeTemp(directory);
	}
}
try {
	const candidates = (await tx(db => db.query<Candidate>(`${missing} order by f.created_at,f.id limit 24`))).rows;
	report.candidates = candidates.length;
	if (apply) for (const candidate of candidates) {
		try { await one(candidate); }
		catch (error) { report.failed++; report.errors.push(safeError(error)); }
		console.log(JSON.stringify({ completed: report.completed, failed: report.failed, total: candidates.length }));
	}
	const after = await tx(db => db.query<{ id: string; sha256: string }>("select id,sha256 from pm.file_assets where id=any($1::uuid[])", [candidates.map(f => f.id)]));
	report.canonicalHashesPreserved = after.rows.length === candidates.length && candidates.every(file => after.rows.some(row => row.id === file.id && row.sha256 === file.sha256));
	report.remaining = (await tx(db => db.query(`${missing}`))).rowCount ?? 0;
} catch (error) {
	report.failed++; report.errors.push(safeError(error));
} finally {
	await mkdir("docs/evidence/performance-stage2", { recursive: true });
	await writeFile(`docs/evidence/performance-stage2/thumbnails-${apply ? "applied" : "preview"}.json`, `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report));
	await getPool(true).end();
}
if (report.failed || !report.canonicalHashesPreserved) process.exitCode = 1;
