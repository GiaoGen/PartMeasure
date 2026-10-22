import { buildId } from "@/lib/build-info";
export const dynamic = "force-dynamic";

export function GET() {
	return Response.json(
		{ status: "ok", scope: "P0-1", database: "not-probed", buildId },
		{
			headers: { "Cache-Control": "private, no-store" },
		},
	);
}
