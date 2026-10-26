import "server-only";
import type { Actor } from "./db";
import { owner } from "./auth";
import { fileForRead } from "./service";
import { AppError } from "../policy";

/** The route already verified the initial identity. Long transfers refresh it;
 * project/link/file authorization still runs on every call. */
export function fileAuthorizer(actor: Actor, projectId: string, fileId: string, original = false, variant: number | null = null) {
	let verifiedAt = Date.now();
	return async () => {
		if (actor.kind === "owner" && Date.now() - verifiedAt >= 5000) {
			if ((await owner()).id !== actor.id) throw new AppError("AUTH_REQUIRED", 401);
			verifiedAt = Date.now();
		}
		return fileForRead(actor, projectId, fileId, original, variant);
	};
}
