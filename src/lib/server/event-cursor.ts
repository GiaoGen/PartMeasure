import "server-only";
import { createHash } from "node:crypto";
import type { Actor } from "./db";
import { AppError } from "../policy";

const scope = (actor: Actor, project: string) =>
	createHash("sha256")
		.update(
			JSON.stringify([project, actor.kind, actor.kind === "owner" ? actor.id : actor.hash]),
		)
		.digest("hex")
		.slice(0, 24);
export function eventCursor(actor: Actor, project: string, sequence: string) {
	return Buffer.from(JSON.stringify({ s: scope(actor, project), n: sequence })).toString(
		"base64url",
	);
}
/** Context binding only. Every use separately checks live project/link permissions. */
export function eventSequence(actor: Actor, project: string, cursor: string | null) {
	if (!cursor) return null;
	try {
		if (!/^[A-Za-z0-9_-]{1,200}$/.test(cursor)) throw Error();
		const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
		if (
			value.s !== scope(actor, project) ||
			typeof value.n !== "string" ||
			!/^\d{1,19}$/.test(value.n) ||
			BigInt(value.n) > 9223372036854775807n
		)
			throw Error();
		return value.n as string;
	} catch {
		throw new AppError("CURSOR_INVALID", 422);
	}
}
