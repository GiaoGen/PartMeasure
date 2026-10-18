import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { AppError } from "../policy";
import { appOrigin } from "./origin";
export const uuid = z.uuid();
export function sameOrigin(req: Request) {
	const origin = req.headers.get("origin");
	const expected = appOrigin();
	if (
		!expected ||
		origin !== new URL(expected).origin ||
		req.headers.get("sec-fetch-site") === "cross-site"
	)
		throw new AppError("FORBIDDEN", 403);
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
	if (!req.headers.get("content-type")?.startsWith("application/json"))
		throw new AppError("INVALID_INPUT", 415);
	const reader = req.body?.getReader();
	if (!reader) throw new AppError("INVALID_INPUT", 400);
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.length;
		if (size > 65536) {
			await reader.cancel();
			throw new AppError("BODY_TOO_LARGE", 413);
		}
		chunks.push(value);
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
