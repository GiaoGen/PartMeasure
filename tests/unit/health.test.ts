import { describe, expect, it } from 'vitest';
import { GET } from '../../src/app/api/health/route';

describe('infrastructure health, without external credentials', () => {
  it('reports liveness without claiming database readiness and prevents caching', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ status: 'ok', scope: 'P0-1', database: 'not-probed' });
  });
});
