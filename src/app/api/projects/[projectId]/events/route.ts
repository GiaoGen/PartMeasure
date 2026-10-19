import { endpoint } from "@/lib/server/http";
import { projectStream } from "@/lib/server/project-stream";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: Request, context: { params: Promise<{ projectId: string }> }) {
	return endpoint(async () => projectStream(req, (await context.params).projectId, false));
}
