import { uploadEndpoint, type UploadContext } from "@/lib/server/upload-endpoint";
export const maxDuration = 60;
export async function POST(req: Request, context: UploadContext) { return uploadEndpoint(req, context, true); }
