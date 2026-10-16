export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok', scope: 'P0-0', database: 'not-connected' }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
