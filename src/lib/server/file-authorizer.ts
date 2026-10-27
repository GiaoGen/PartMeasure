import "server-only";
import type { Actor } from "./db";
import { authClient, verifiedOwner } from "./auth";
import { fileForRead } from "./service";
import { AppError } from "../policy";

/** The route already verified the initial identity. Long transfers refresh it;
 * project/link/file authorization still runs on every call. */
export async function fileAuthorizer(actor: Actor, projectId: string, fileId: string, original = false, variant: number | null = null) {
	// Capture cookies while the Route Handler request is active. Pull callbacks
	// may execute after Next has left that scope; never reacquire cookies there.
	const client = actor.kind === "owner" ? await authClient() : null;
	let verifiedAt = Date.now();
	return async () => {
		if (actor.kind === "owner" && client && Date.now() - verifiedAt >= 5000) {
			if ((await verifiedOwner(client)).id !== actor.id) throw new AppError("AUTH_REQUIRED", 401);
			verifiedAt = Date.now();
		}
		return fileForRead(actor, projectId, fileId, original, variant);
	};
}
