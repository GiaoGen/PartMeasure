export const dynamic = "force-dynamic";

export function GET() {
	return Response.json(
		{ status: "ok", scope: "P0-1", database: "not-probed" },
		{
			headers: { "Cache-Control": "private, no-store" },
		},
	);
}
