import { describe, expect, it } from 'vitest';
import { formatApiRouteCoverage } from './audit-api-route-coverage.mjs';

describe('formatApiRouteCoverage', () => {
  it('formats basic inventory', () => {
    const inventory = {
      root: '/project',
      routesRoot: 'src/routes',
      counts: {
        routeHandlers: 10,
        routeLocalTests: 8,
        missingDirectTests: 2
      },
      missingDirectTests: ['a/+server.ts', 'b/+server.ts']
    };
    const out = formatApiRouteCoverage(inventory);
    expect(out).toContain('API route coverage inventory');
    expect(out).toContain('root: /project');
    expect(out).toContain('routeHandlers: 10');
    expect(out).toContain('routeLocalTests: 8');
    expect(out).toContain('missingDirectTests: 2');
    expect(out).toContain('Handlers without route-local tests:');
    expect(out).toContain('- a/+server.ts');
    expect(out).toContain('- b/+server.ts');
  });

  it('omits missing list when empty', () => {
    const inventory = {
      root: '/project',
      routesRoot: 'src/routes',
      counts: {
        routeHandlers: 5,
        routeLocalTests: 5,
        missingDirectTests: 0
      },
      missingDirectTests: []
    };
    const out = formatApiRouteCoverage(inventory);
    expect(out).not.toContain('Handlers without route-local tests');
  });
});
