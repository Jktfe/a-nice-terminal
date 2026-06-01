import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getIdentityDb } from './db';
import {
  getDefaultLensIds,
  seedDefaultLenses
} from './verificationLensSeed';
import { getValidationSchema } from './validationLensStore';
import { listLensTagRows, resetLensTagRowsStoreForTests } from './lensTagRowsStore';

beforeEach(() => {
  resetLensTagRowsStoreForTests();
  getIdentityDb().prepare('DELETE FROM verification_lenses').run();
});

afterEach(() => {
  resetLensTagRowsStoreForTests();
  getIdentityDb().prepare('DELETE FROM verification_lenses').run();
});

describe('seedDefaultLenses', () => {
  it('seeds three canonical lenses + matching tag rows on first call', () => {
    const created = seedDefaultLenses();
    expect(created.sort()).toEqual(
      getDefaultLensIds().sort()
    );
    for (const lensId of getDefaultLensIds()) {
      const lens = getValidationSchema(lensId);
      expect(lens).not.toBeNull();
      const rows = listLensTagRows(lensId);
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  it('is idempotent — re-running seedDefaultLenses skips existing lenses', () => {
    const first = seedDefaultLenses();
    expect(first).toHaveLength(3);
    const second = seedDefaultLenses();
    expect(second).toEqual([]);
  });

  it('lens-link-verify-1-agent has 3 link rows with majority-or-any-pass dispute policy', () => {
    seedDefaultLenses();
    const rows = listLensTagRows('lens-link-verify-1-agent');
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.minVerifierCount === 1)).toBe(true);
    expect(rows.every((r) => r.disputePolicy === 'any-pass')).toBe(true);
    expect(rows.map((r) => r.tagId).sort()).toEqual(['link.file', 'link.html', 'link.repo']);
  });

  it('lens-link-verify-2-agent uses consensus-required + majority dispute policy + out-of-scope ignorable', () => {
    seedDefaultLenses();
    const rows = listLensTagRows('lens-link-verify-2-agent');
    const linkRows = rows.filter((r) => r.tagId.startsWith('link.'));
    expect(linkRows).toHaveLength(3);
    expect(linkRows.every((r) => r.expectation === 'consensus-required')).toBe(true);
    expect(linkRows.every((r) => r.minVerifierCount === 2)).toBe(true);
    expect(linkRows.every((r) => r.disputePolicy === 'majority')).toBe(true);
    const ignorable = rows.find((r) => r.tagId === 'process.flagged-ignorable');
    expect(ignorable?.expectation).toBe('out-of-scope');
  });

  it('lens-source-context-1h1a binds human+agent verifier-mix and weights primary/reputable sources', () => {
    seedDefaultLenses();
    const rows = listLensTagRows('lens-source-context-1h1a');
    const factual = rows.find((r) => r.tagId === 'claim.factual');
    expect(factual).toBeTruthy();
    expect(factual!.verifierMix).toEqual(['@human-reviewer', '@agent-verifier']);
    expect(factual!.disputePolicy).toBe('unanimous');
    const primary = rows.find((r) => r.tagId === 'source.primary');
    expect(primary?.weight).toBe(2.0);
    const reputable = rows.find((r) => r.tagId === 'source.reputable');
    expect(reputable?.weight).toBe(1.5);
    const unverified = rows.find((r) => r.tagId === 'source.unverified');
    expect(unverified?.expectation).toBe('forbidden');
    const refutes = rows.find((r) => r.tagId === 'source.refutes-claim');
    expect(refutes?.disputePolicy).toBe('escalate');
  });

  it('every seeded row carries a non-empty notes field (rationale for the binding)', () => {
    seedDefaultLenses();
    for (const lensId of getDefaultLensIds()) {
      const rows = listLensTagRows(lensId);
      for (const row of rows) {
        expect(row.notes).toBeTruthy();
        expect(row.notes!.length).toBeGreaterThan(10);
      }
    }
  });
});
