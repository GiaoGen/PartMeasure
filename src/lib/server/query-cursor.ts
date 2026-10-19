import "server-only";
import { z } from "zod";
import { createHash } from "node:crypto";
import { AppError } from "../policy";

const schema = z
	.object({
		v: z.literal(1),
		scope: z.string().regex(/^[a-f0-9]{64}$/),
		id: z.uuid(),
	})
	.strict();
export function cursorScope(context: readonly unknown[]) {
	return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}
export function queryCursor(id: string, scope: string) {
	return Buffer.from(JSON.stringify({ v: 1, scope, id })).toString("base64url");
}
// The scope detects mixed query pages; it grants no authority. Every anchor is
// looked up again inside the current RLS/owner-filtered result, never trusted.
export function cursorId(value: string | null, scope: string, legacy = false) {
	if (value === null) return null;
	if (legacy && z.uuid().safeParse(value).success) return value;
	try {
		if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
		const bytes = Buffer.from(value, "base64url");
		if (bytes.toString("base64url") !== value) throw Error();
		const parsed = schema.parse(JSON.parse(bytes.toString("utf8")));
		if (parsed.scope !== scope) throw Error();
		return parsed.id;
	} catch {
		throw new AppError("CURSOR_INVALID", 422);
	}
}
