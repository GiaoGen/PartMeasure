import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { AppError } from "../policy";
import { appWriteOrigins } from "./origin";
import { writeOriginAllowed } from "../request-origin";
import { withRequestTiming } from "./timing";
import { dependencyHint } from "./dependency-hint";
import { readWithSignal } from "./bounded-stream";
export const uuid = z.uuid();
export function sameOrigin(req: Request) {
	if (!writeOriginAllowed(req, appWriteOrigins(), !process.env.VERCEL && !process.env.VERCEL_ENV))
		throw new AppError("ORIGIN_MISMATCH", 403);
}
export async function csrf(req: Request) {
	sameOrigin(req);
	const value = (await cookies()).get("pm_csrf")?.value ?? "";
	const header = req.headers.get("x-csrf-token") ?? "";
	if (
		!/^[A-Za-z0-9_-]{43}$/.test(value) ||
		!/^[A-Za-z0-9_-]{43}$/.test(header) ||
		value.length !== header.length ||
		!timingSafeEqual(Buffer.from(value), Buffer.from(header))
	)
		throw new AppError("CSRF_INVALID", 403);
}
export async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
	if (req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json")
		throw new AppError("INVALID_INPUT", 415);
	const declared = req.headers.get("content-length");
	if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 65536))
		throw new AppError("BODY_TOO_LARGE", 413);
	const reader = req.body?.getReader();
	if (!reader) throw new AppError("INVALID_INPUT", 400);
	const deadline = AbortSignal.any([req.signal, AbortSignal.timeout(15000)]);
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await readWithSignal(reader, deadline);
			if (done) break;
			size += value.length;
			if (size > 65536) throw new AppError("BODY_TOO_LARGE", 413);
			chunks.push(value);
		}
	} catch (error) {
		void reader.cancel().catch(() => {});
		if (deadline.aborted) throw new AppError("REQUEST_TIMEOUT", 408);
		throw error;
	} finally {
		reader.releaseLock();
	}
	try {
		return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
	} catch {
		throw new AppError("INVALID_INPUT", 422);
	}
}
export const idemKey = (req: Request) => {
	const k = uuid.safeParse(req.headers.get("idempotency-key"));
	if (!k.success) throw new AppError("IDEMPOTENCY_KEY_REQUIRED", 428);
	return k.data;
};
export const response = (data: unknown, status = 200) =>
	Response.json(
		{ data, requestId: randomUUID() },
		{
			status,
			headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
		},
	);
export async function endpoint(work: () => Promise<Response>) {
	return withRequestTiming(() => runEndpoint(work));
}
async function runEndpoint(work: () => Promise<Response>) {
	try {
		return await work();
	} catch (error) {
		const requestId = randomUUID();
		const dependencyCode =
			new Map([
				["55P03", "DATABASE_BUSY"],
				["57014", "DATABASE_TIMEOUT"],
				["53300", "DATABASE_CAPACITY"],
				["ETIMEDOUT", "DEPENDENCY_TIMEOUT"],
			]).get((error as { code?: string } | null)?.code ?? "") ??
			"DEPENDENCY_UNAVAILABLE";
		const safe =
			error instanceof AppError ? error : new AppError(dependencyCode, 503);
		if (!(error instanceof AppError)) {
			const sqlState = (error as { code?: string } | null)?.code;
			console.warn(
				JSON.stringify({
					event: "dependency_failed",
					code: dependencyCode,
					hint: dependencyHint(error),
					sqlState:
						sqlState && /^[0-9A-Z]{5}$/.test(sqlState) ? sqlState : undefined,
					requestId,
				}),
			);
		}
		return Response.json(
			{
				error: { code: safe.code, message: safe.code },
				requestId,
			},
			{
				status: safe.status,
				headers: {
					"Cache-Control": "private, no-store",
					...(safe.status === 429 ? { "Retry-After": "60" } : {}),
				},
			},
		);
	}
}
