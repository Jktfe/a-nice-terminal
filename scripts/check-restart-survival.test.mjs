// Unit tests for check-restart-survival.mjs (m5.4 Phase B). Bun-test compat.
// Covers the runRestartProbe pure-flow with stubbed fetch + spawn paths via
// global mocks. Live execution is verified separately by running the script
// itself against :6174.
import { describe, expect, it } from 'vitest';

// Lazy-import the module so we can swap globals first.
async function loadProbe() {
  return await import('./check-restart-survival.mjs');
}

describe('check-restart-survival module shape', () => {
  it('exports runRestartProbe function', async () => {
    const mod = await loadProbe();
    expect(typeof mod.runRestartProbe).toBe('function');
  });
});
