import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import path from "node:path";
import type pg from "pg";

export function pgEnvironment(url: URL, caFile: string) {
	return { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
		PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
		PGSSLMODE: "verify-full", PGSSLROOTCERT: caFile, PGCONNECT_TIMEOUT: "10", PGOPTIONS: "-c statement_timeout=300000 -c lock_timeout=5000" };
}
export function postgresTool(bin: string, name: "pg_dump" | "pg_restore", args: string[], environment: NodeJS.ProcessEnv, signal: AbortSignal) {
	const child = spawn(path.join(bin, process.platform === "win32" ? `${name}.exe` : name), args, { env: environment, shell: false, windowsHide: true, signal, stdio: ["ignore", "pipe", "pipe"] });
	// Never print pg stderr: it can contain server names, SQL or sensitive values.
	child.stderr.resume();
	const done = new Promise<void>((resolve, reject) => {
		child.once("error", () => reject(Error("POSTGRES_TOOL_FAILED")));
		child.once("close", code => code === 0 ? resolve() : reject(Error("POSTGRES_TOOL_FAILED")));
	});
	void done.catch(() => {});
	return { output: child.stdout as Readable, done, stop: () => child.kill() };
}

/** Stable row content hashes, without holding a whole table in application memory. */
export async function databaseFingerprints(db: pg.Client, signal?: AbortSignal) {
	const names = (await db.query<{ name: string }>("select tablename as name from pg_tables where schemaname='pm' order by tablename")).rows;
	const result: Record<string, { rows: number; sha256: string }> = {};
	const { createHash } = await import("node:crypto");
	for (const { name } of names) {
		signal?.throwIfAborted();
		if (!/^[a-z_]+$/.test(name)) throw Error("INVALID_TABLE_NAME");
		const hash = createHash("sha256"); let rows = 0;
		await db.query(`declare backup_rows no scroll cursor for select to_jsonb(t)::text as record from pm."${name}" t order by to_jsonb(t)::text collate "C"`);
		try {
			for (;;) {
				signal?.throwIfAborted();
				const page = await db.query<{ record: string }>("fetch 100 from backup_rows");
				for (const row of page.rows) { hash.update(`${row.record}\n`); rows++; }
				if (page.rows.length < 100) break;
			}
		} finally { await db.query("close backup_rows"); }
		result[name] = { rows, sha256: hash.digest("hex") };
	}
	return result;
}

export function cancelDatabaseOnAbort(db: pg.Client, signal: AbortSignal) {
	const abort = () => { void db.end().catch(() => {}); };
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) abort();
	return () => signal.removeEventListener("abort", abort);
}
