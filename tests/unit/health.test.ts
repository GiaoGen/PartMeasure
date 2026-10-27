import { describe, expect, it } from 'vitest';
import { GET } from '../../src/app/api/health/route';

describe('infrastructure health, without external credentials', () => {
  it('reports liveness without claiming database readiness and prevents caching', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({ status: 'ok', scope: 'P0-1', database: 'not-probed' });
    expect(body.buildId).toBe(process.env.PM_BUILD_ID ?? 'unbuilt');
  });
});
