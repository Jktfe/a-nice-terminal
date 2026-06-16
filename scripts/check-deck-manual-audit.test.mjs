// Smoke tests for check-deck-manual-audit.mjs (m5.6).
import { describe, expect, it } from 'vitest';
import { deliveryPlanAvailable, runDeckManualAudit } from './check-deck-manual-audit.mjs';

// The audit reads a DELIVERY-PLAN.md from the sibling ANT-Open-Slide repo. That
// repo is absent in CI, /tmp worktrees, and fresh clones — skip rather than
// fail when it isn't on disk, so the suite is location-independent.
describe.skipIf(!deliveryPlanAvailable())('check-deck-manual-audit', () => {
  it('runDeckManualAudit completes without throwing on current disk', () => {
    const out = [];
    const result = runDeckManualAudit({ writeOut: (s) => out.push(s) });
    expect(result.manifestVerbs).toBeGreaterThan(0);
    expect(result.dpVerbs).toBeGreaterThan(0);
    expect(result.overlap).toBeGreaterThan(0);
    expect(out.some((line) => line.includes('AUDIT OK'))).toBe(true);
  });
  it('delta-1: planned-row primary verbs (chair/interview/voice) are recognised, not aspirational-backlog drift', () => {
    const out = [];
    runDeckManualAudit({ writeOut: (s) => out.push(s) });
    const aspirational = out.find((l) => l.startsWith('aspirational-backlog')) ?? '';
    for (const planned of ['chair', 'interview', 'voice']) {
      expect(aspirational, `${planned} should NOT appear in aspirational-backlog`).not.toMatch(new RegExp(`\\b${planned}\\b`));
    }
  });
});
