import { createHash } from "node:crypto";
import { AppError } from "../../src/lib/policy";
import { connectionTarget } from "../maintenance/connection-model";

export const root = "http://127.0.0.1:3000";
export const phases = ["seed", "workflow", "revoke"] as const;
export type Phase = (typeof phases)[number];
export const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function options(args: string[]) {
	if (!args.length) return { mode: "prepare" as const };
	if (args.length === 2 && args[0] === "--inspect" && validRun(args[1])) return { mode: "inspect" as const, run: args[1] as string };
	if (args.length === 2 && args[0] === "--review-source" && validRun(args[1])) return { mode: "review-source" as const, run: args[1] as string };
	if (args.length === 5 && args[0] === "--apply" && args[1] === "--run" && validRun(args[2]) && args[3] === "--phase" && phases.includes(args[4] as Phase))
		return { mode: "apply" as const, run: args[2] as string, phase: args[4] as Phase };
	throw new AppError("INVALID_FIX_C_ARGUMENTS");
}
export function validRun(value: string | undefined) {
	return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
export function target(env: Record<string, string | undefined>) {
	return connectionTarget(env, true);
}
export type Asset = { key: string; filename: string; mime: string; purpose: "material" | "delivery"; bytes: number; sha256: string };
export function boundedAssets(assets: Asset[]) {
	if (assets.length !== 4 || new Set(assets.map(a => a.key)).size !== 4 ||
		assets.some(a => !Number.isSafeInteger(a.bytes) || a.bytes <= 0 || !/^[a-f0-9]{64}$/.test(a.sha256)) ||
		assets.reduce((sum, a) => sum + a.bytes, 0) > 4 * 1024 * 1024)
		throw new AppError("FIX_C_ASSET_SCOPE_EXCEEDED");
}
export type Operation = { key: string; requestHash: string; status: "pending" | "done"; value?: unknown };
export type Journal = { operations: Record<string, Operation> };
/** Persist pending BEFORE sending. Ambiguous results require read-only reconciliation, never automatic replay. */
export async function once<T>(journal: Journal, name: string, request: unknown, key: () => string, save: () => Promise<void>, work: (key: string) => Promise<T>): Promise<T> {
	const fingerprint = hash(JSON.stringify(request));
	const previous = journal.operations[name];
	if (previous) {
		if (previous.requestHash !== fingerprint) throw new AppError("FIX_C_OPERATION_CHANGED");
		if (previous.status !== "done") throw new AppError("FIX_C_PENDING_REQUIRES_RECONCILIATION");
		return previous.value as T;
	}
	const operation: Operation = { key: key(), requestHash: fingerprint, status: "pending" };
	journal.operations[name] = operation;
	await save();
	const value = await work(operation.key);
	operation.value = value;
	operation.status = "done";
	await save();
	return value;
}
export function projectScope(journal: Journal) {
	const operation = journal.operations.project;
	const value = operation?.value as { id?: string; name?: string } | undefined;
	if (operation?.status !== "done" || !value?.id || !/^[a-f0-9-]{36}$/.test(value.id) || !value.name?.startsWith("FIX-C-"))
		throw new AppError("FIX_C_NEW_PROJECT_REQUIRED");
	return value.id;
}
export function publicProgress(journal: Journal) {
	return Object.entries(journal.operations).map(([name, op]) => ({ name, status: op.status }));
}
