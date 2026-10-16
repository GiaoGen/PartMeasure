import { expect, test } from '@playwright/test';

test('App Router baseline renders; no business UI is approved', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PartMeasure · P0-0');
  await expect(page.getByText('工程基线已启动。业务交互方案待审批。')).toBeVisible();
  const health = await request.get('/api/health');
  expect(health.ok()).toBeTruthy();
  expect(health.headers()['cache-control']).toContain('no-store');
  expect(health.headers()['referrer-policy']).toBe('no-referrer');
  expect(await health.json()).toEqual({ status: 'ok', scope: 'P0-0', database: 'not-connected' });
});
