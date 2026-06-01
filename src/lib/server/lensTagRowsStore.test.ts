import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createValidationSchema } from './validationLensStore';
import {
  createLensTagRow,
  deleteLensTagRow,
  findLensTagRowsForTag,
  getLensTagRow,
  listLensTagRows,
  resetLensTagRowsStoreForTests
} from './lensTagRowsStore';
import { getIdentityDb } from './db';

function freshLens(id: string) {
  return createValidationSchema({
    id,
    name: id,
    description: null,
    lensKind: 'custom',
    scope: 'public',
    scopeId: 'global',
    rulesJson: '[]',
    createdBy: '@test',
    archivedAtMs: null
  });
}

beforeEach(() => {
  resetLensTagRowsStoreForTests();
  // Clear lenses too so each test starts clean
  getIdentityDb().prepare('DELETE FROM verification_lenses').run();
});

afterEach(() => {
  resetLensTagRowsStoreForTests();
  getIdentityDb().prepare('DELETE FROM verification_lenses').run();
});

describe('createLensTagRow', () => {
  it('creates a row with sensible defaults', () => {
    const lens = freshLens('lens-test-1');
    const row = createLensTagRow({
      lensId: lens.id,
      tagId: 'ant.claim.factual',
      expectation: 'required',
      createdBy: '@james'
    });
    expect(row.minVerifierCount).toBe(1);
    expect(row.verifierMix).toEqual([]);
    expect(row.disputePolicy).toBe('majority');
    expect(row.weight).toBe(1.0);
    expect(row.tagVersion).toBeNull();
  });

  it('refuses orphan rows (no such lens)', () => {
    expect(() =>
      createLensTagRow({
        lensId: 'lens-nope',
        tagId: 'ant.claim.factual',
        expectation: 'required',
        createdBy: '@james'
      })
    ).toThrow(/lens lens-nope does not exist/);
  });

  it('persists all fields including verifier_mix array', () => {
    const lens = freshLens('lens-test-2');
    const row = createLensTagRow({
      lensId: lens.id,
      tagId: 'ant.source.primary',
      tagVersion: 3,
      expectation: 'consensus-required',
      minVerifierCount: 3,
      verifierMix: ['@verifier-1', '@verifier-2', '@verifier-3'],
      disputePolicy: 'unanimous',
      weight: 2.5,
      notes: 'critical claim — needs 3-of-3 consensus',
      createdBy: '@james'
    });
    const back = getLensTagRow(row.id);
    expect(back).toBeTruthy();
    expect(back!.tagVersion).toBe(3);
    expect(back!.verifierMix).toEqual(['@verifier-1', '@verifier-2', '@verifier-3']);
    expect(back!.disputePolicy).toBe('unanimous');
    expect(back!.weight).toBe(2.5);
    expect(back!.notes).toBe('critical claim — needs 3-of-3 consensus');
  });
});

describe('listLensTagRows', () => {
  it('returns rows for a lens in creation order', () => {
    const lens = freshLens('lens-test-3');
    createLensTagRow({
      lensId: lens.id,
      tagId: 'ant.claim.factual',
      expectation: 'required',
      createdBy: '@a'
    });
    createLensTagRow({
      lensId: lens.id,
      tagId: 'ant.source.primary',
      expectation: 'required',
      createdBy: '@a'
    });
    createLensTagRow({
      lensId: lens.id,
      tagId: 'ant.context.technical',
      expectation: 'heuristic-allowed',
      createdBy: '@a'
    });
    const rows = listLensTagRows(lens.id);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.tagId)).toEqual([
      'ant.claim.factual',
      'ant.source.primary',
      'ant.context.technical'
    ]);
  });

  it('isolates rows per lens', () => {
    const a = freshLens('lens-a');
    const b = freshLens('lens-b');
    createLensTagRow({
      lensId: a.id,
      tagId: 't1',
      expectation: 'required',
      createdBy: '@x'
    });
    createLensTagRow({
      lensId: b.id,
      tagId: 't2',
      expectation: 'forbidden',
      createdBy: '@x'
    });
    expect(listLensTagRows(a.id).map((r) => r.tagId)).toEqual(['t1']);
    expect(listLensTagRows(b.id).map((r) => r.tagId)).toEqual(['t2']);
  });
});

describe('findLensTagRowsForTag', () => {
  it('returns rows across multiple lenses that reference the same tag', () => {
    const a = freshLens('lens-q');
    const b = freshLens('lens-r');
    createLensTagRow({
      lensId: a.id,
      tagId: 'ant.claim.factual',
      expectation: 'required',
      createdBy: '@x'
    });
    createLensTagRow({
      lensId: b.id,
      tagId: 'ant.claim.factual',
      expectation: 'consensus-required',
      createdBy: '@x'
    });
    createLensTagRow({
      lensId: a.id,
      tagId: 'ant.source.primary',
      expectation: 'required',
      createdBy: '@x'
    });
    const hits = findLensTagRowsForTag('ant.claim.factual');
    expect(hits).toHaveLength(2);
    expect(hits.map((r) => r.lensId).sort()).toEqual(['lens-q', 'lens-r']);
  });
});

describe('deleteLensTagRow', () => {
  it('removes a row, returns true on success', () => {
    const lens = freshLens('lens-del');
    const row = createLensTagRow({
      lensId: lens.id,
      tagId: 'ant.claim.factual',
      expectation: 'required',
      createdBy: '@x'
    });
    expect(deleteLensTagRow(row.id)).toBe(true);
    expect(getLensTagRow(row.id)).toBeNull();
  });

  it('returns false when deleting a non-existent row', () => {
    expect(deleteLensTagRow('ltr-nope')).toBe(false);
  });
});

describe('verification_lenses new columns', () => {
  it('lens reads back default values for new temporal/scope columns', () => {
    const lens = freshLens('lens-cols');
    // The store doesn't expose these new columns yet (deferred to a
    // future API surface), but the DDL defaults must be present so
    // existing consumers don't see NULL.
    const row = getIdentityDb()
      .prepare(
        `SELECT minimum_pass_record_age_ms, re_verification_on_content_change, out_of_scope_tags_json
         FROM verification_lenses WHERE id = ?`
      )
      .get(lens.id) as {
      minimum_pass_record_age_ms: number | null;
      re_verification_on_content_change: number;
      out_of_scope_tags_json: string;
    };
    expect(row.minimum_pass_record_age_ms).toBeNull();
    expect(row.re_verification_on_content_change).toBe(0);
    expect(row.out_of_scope_tags_json).toBe('[]');
  });
});
