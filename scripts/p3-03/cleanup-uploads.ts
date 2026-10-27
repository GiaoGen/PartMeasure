// Explicit one-shot maintenance, never a continuously running upload worker.
import nextEnv from "@next/env";
import { cleanupScopeSchema, cleanupUploads } from "../../src/lib/server/upload-cleanup";
import { getPool } from "../../src/lib/server/db";
import { readFile } from "node:fs/promises";
import { maintenanceTarget } from "../maintenance/target";
import { connectionFailure } from "../maintenance/connection-model";

try {
	nextEnv.loadEnvConfig(process.cwd());
	const args = process.argv.slice(2);
	const mode = args[0] ?? "--dry-run", apply = mode === "--apply";
	if (!["--dry-run", "--apply"].includes(mode) || ![0, 1, 3].includes(args.length) ||
		(args.length === 3 && args[1] !== "--scope-file") || (apply && args.length !== 3)) throw Error("INVALID_ARGUMENTS");
	maintenanceTarget(process.env);
	const content = args.length === 3 ? await readFile(args[2] as string) : undefined;
	if (content && content.length > 4096) throw Error("SCOPE_TOO_LARGE");
	const scope = content ? cleanupScopeSchema.parse(JSON.parse(content.toString("utf8"))) : undefined;
	const result = await cleanupUploads(apply, 20, AbortSignal.timeout(120000), scope);
	console.log(JSON.stringify({ event: "upload_cleanup", mode: apply ? "apply" : "dry-run", ...result }));
	if (result.failed || result.interrupted) process.exitCode = 1;
} catch (error) {
	console.error(JSON.stringify({ event: "upload_cleanup_failed", ...connectionFailure(error) })); process.exitCode = 1;
} finally { try { await getPool(true).end(); } catch { /* Configuration failed before a pool was created. */ } }
