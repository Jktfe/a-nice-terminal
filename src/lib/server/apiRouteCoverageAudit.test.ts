import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectApiRouteCoverage,
  formatApiRouteCoverage
} from '../../../scripts/audit-api-route-coverage.mjs';

function writeFile(path: string, content = '') {
  mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
  writeFileSync(path, content);
}

describe('audit-api-route-coverage', () => {
  it('inventories API route handlers and route-local tests', () => {
    const root = mkdtempSync(join(tmpdir(), 'ant-route-coverage-'));
    try {
      writeFile(join(root, 'src/routes/api/covered/+server.ts'));
      writeFile(join(root, 'src/routes/api/covered/server.test.ts'));
      writeFile(join(root, 'src/routes/api/nested/[id]/+server.ts'));
      writeFile(join(root, 'src/routes/not-api/+server.ts'));

      const inventory = collectApiRouteCoverage({ root });

      expect(inventory.counts.routeHandlers).toBe(2);
      expect(inventory.counts.routeLocalTests).toBe(1);
      expect(inventory.missingDirectTests).toEqual([
        'src/routes/api/nested/[id]/+server.ts'
      ]);
      expect(formatApiRouteCoverage(inventory)).toContain('missingDirectTests: 1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
