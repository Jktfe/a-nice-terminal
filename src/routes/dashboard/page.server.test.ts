import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES_DIR = join(process.cwd(), 'src/routes');

describe('dashboard direct-open aliases', () => {
  it.each([
    ['dashboard', join(ROUTES_DIR, 'dashboard/+page.server.ts'), () => import('./+page.server')],
    ['dash', join(ROUTES_DIR, 'dash/+page.server.ts'), () => import('../dash/+page.server')]
  ])('/%s redirects to the canonical dashboard route', async (_alias, routeFile, loadModule) => {
    expect(existsSync(routeFile)).toBe(true);

    const { load } = await loadModule();

    await expect(load({} as never)).rejects.toMatchObject({
      status: 307,
      location: '/'
    });
  });
});
