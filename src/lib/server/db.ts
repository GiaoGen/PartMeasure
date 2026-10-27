import "server-only";
import { createHash, randomBytes } from "node:crypto";
import pg, { type PoolClient } from "pg";
import { readFileSync } from "node:fs";
import { AppError } from "../policy";
import { observedClient, timed } from "./timing";
export const digest = (value: string | Buffer) =>
	createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export type Actor =
	| { kind: "owner"; id: string }
	| { kind: "guest"; hash: string };
let runtimePool: pg.Pool | undefined;
let workerPool: pg.Pool | undefined;
export function getPool(worker = false) {
	const url = process.env[worker ? "WORKER_DATABASE_URL" : "DATABASE_URL"];
	if (!url) throw new AppError("DATABASE_NOT_CONFIGURED", 503);
	// No sslmode query override: use verified TLS, optional provider CA supplied by path in Node NODE_EXTRA_CA_CERTS.
	const connection = new URL(url);
	connection.searchParams.delete("sslmode");
	const expected = worker ? "partmeasure_worker" : "partmeasure_runtime";
	if (!decodeURIComponent(connection.username).startsWith(expected))
		throw new AppError("UNSAFE_DATABASE_ROLE", 503);
	const pool = worker ? workerPool : runtimePool;
	if (pool) return pool;
	const ca =
		process.env.DATABASE_CA_PEM ??
		(process.env.DATABASE_CA_FILE
			? readFileSync(process.env.DATABASE_CA_FILE, "utf8")
			: undefined);
	const created = new pg.Pool({
		connectionString: connection.href,
		// Two-role page loads need room for short preflight/read transactions.
		// Keep a small per-process ceiling; maintenance retains its original cap.
		max: worker ? 2 : 4,
		ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
		connectionTimeoutMillis: 10000,
		idleTimeoutMillis: 10000,
	});
	created.on("error", () => {
		/* No connection string or bind values in logs. */
	});
	if (worker) workerPool = created;
	else runtimePool = created;
	return created;
}
async function oneTransaction<T>(
	actor: Actor | null,
	work: (db: PoolClient) => Promise<T>,
	worker = false,
): Promise<T> {
	const client = observedClient(await timed("pool", () => getPool(worker).connect()));
	let broken = false;
	try {
		await client.query("begin");
		const { rows } = await client.query(
			"select current_user as role,set_config('statement_timeout','5000',true),set_config('lock_timeout','2000',true),set_config('pm.owner_id',$1,true),set_config('pm.guest_hash',$2,true),set_config('pm.link_hash','',true)",
			[
				actor?.kind === "owner" ? actor.id : "",
				actor?.kind === "guest" ? actor.hash : "",
			],
		);
		if (
			rows[0]?.role !== (worker ? "partmeasure_worker" : "partmeasure_runtime")
		)
			throw new AppError("UNSAFE_DATABASE_ROLE", 503);
		const value = await work(client);
		await client.query("commit");
		return value;
	} catch (error) {
		try {
			await client.query("rollback");
		} catch {
			broken = true;
		}
		throw error;
	} finally {
		client.release(broken);
	}
}
export async function transaction<T>(
	actor: Actor | null,
	work: (db: PoolClient) => Promise<T>,
	worker = false,
): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await oneTransaction(actor, work, worker);
		} catch (error) {
			const code = (error as { code?: string }).code;
			// These SQLSTATEs abort the attempt and oneTransaction rolls it back first.
			// Bounded retry is safe for SQL-only work; never retry unknown network/commit results.
			if (
				attempt >= 2 ||
				(code !== "40001" && code !== "40P01" && code !== "55P03")
			)
				throw error;
			await new Promise((resolve) =>
				setTimeout(resolve, 25 + Math.random() * 75),
			);
		}
	}
}
export async function rate(
	db: PoolClient,
	key: string,
	max: number,
	seconds = 60,
) {
	const { rows } = await db.query(
		`insert into pm.rate_limits(key,window_at,hits) values($1,now(),1)
 on conflict(key) do update set hits=case when pm.rate_limits.window_at<now()-($2*interval '1 second') then 1 else pm.rate_limits.hits+1 end,
 window_at=case when pm.rate_limits.window_at<now()-($2*interval '1 second') then now() else pm.rate_limits.window_at end returning hits`,
		[key, seconds],
	);
	if (rows[0].hits > max) throw new AppError("RATE_LIMITED", 429);
}
export async function idempotent<T>(
	db: PoolClient,
	scope: string,
	key: string,
	input: unknown,
	work: () => Promise<T>,
): Promise<T> {
	await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
		`${scope}:${key}`,
	]);
	const hash = digest(JSON.stringify(input));
	const { rows } = await db.query(
		"select request_hash,result from pm.idempotency_keys where scope=$1 and key=$2",
		[scope, key],
	);
	if (rows[0]) {
		if (rows[0].request_hash !== hash)
			throw new AppError("IDEMPOTENCY_CONFLICT", 409);
		return rows[0].result as T;
	}
	const result = await work();
	await db.query(
		"insert into pm.idempotency_keys(scope,key,request_hash,result) values($1,$2,$3,$4)",
		[scope, key, hash, JSON.stringify(result)],
	);
	return result;
}
