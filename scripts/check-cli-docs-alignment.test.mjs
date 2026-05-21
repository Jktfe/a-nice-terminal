// Smoke tests for check-cli-docs-alignment.mjs (m5.5).
import { describe, expect, it } from 'vitest';

async function loadProbe() {
  return await import('./check-cli-docs-alignment.mjs');
}

describe('check-cli-docs-alignment module shape', () => {
  it('exports runAlignmentCheck function', async () => {
    const mod = await loadProbe();
    expect(typeof mod.runAlignmentCheck).toBe('function');
  });
});
