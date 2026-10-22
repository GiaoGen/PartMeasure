import "server-only";
import { createHmac } from "node:crypto";
import type { Actor } from "./db";

/** An opaque partition, never a credential. Every use still requires fresh read permission. */
export function imageCacheScope(actor: Actor, projectId: string) {
	const key = process.env.SUPABASE_SECRET_KEY;
	if (!key) return null;
	return createHmac("sha256", key).update(JSON.stringify(["image-cache-v1", projectId, actor.kind, actor.kind === "owner" ? actor.id : actor.hash])).digest("hex");
}
