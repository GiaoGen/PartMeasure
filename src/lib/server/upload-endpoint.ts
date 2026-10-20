import { z } from "zod";
import { guest, owner } from "./auth";
import { body, csrf, endpoint, idemKey, response, uuid } from "./http";
import { completeUpload } from "./complete-upload";
import { AppError } from "../policy";
export type UploadContext = { params: Promise<{ projectId: string; uploadId: string }> };
export function uploadEndpoint(req: Request, context: UploadContext, isGuest: boolean) {
	return endpoint(async () => {
		await csrf(req);
		const { projectId, uploadId } = await context.params;
		if (!uuid.safeParse(projectId).success || !uuid.safeParse(uploadId).success) throw new AppError("NOT_FOUND", 404);
		idemKey(req);
		await body(req, z.object({}).strict());
		const actor = isGuest ? await guest(projectId) : await owner();
		return response(await completeUpload(actor, projectId, uploadId, req.signal));
	});
}
