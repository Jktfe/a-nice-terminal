import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getIdentityDb } from './db';
import {
  applyTag,
  completeTaggingRun,
  createTaggingAnchor,
  getTagApplication,
  getTaggingAnchor,
  getTaggingRun,
  listAnchorsForContent,
  listApplicationsForAnchor,
  listApplicationsForClaim,
  listApplicationsForRun,
  listStaleAnchors,
  listTaggingRuns,
  resetTagApplicationsStoreForTests,
  startTaggingRun
} from './tagApplicationsStore';

beforeEach(() => {
  resetTagApplicationsStoreForTests();
});

afterEach(() => {
  resetTagApplicationsStoreForTests();
});

// ───────────────────────── anchors ─────────────────────────

describe('createTaggingAnchor', () => {
  it('creates an anchor with opaque adapter payload', () => {
    const anchor = createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'artefact-readme-2026-05-28',
      contentHash: 'sha256-abc123',
      anchorData: { startOffset: 100, endOffset: 250 },
      createdBy: '@james'
    });
    expect(anchor.id).toMatch(/^anchor-/);
    expect(anchor.contentKind).toBe('markdown-offset');
    expect(anchor.anchorData).toEqual({ startOffset: 100, endOffset: 250 });
    expect(anchor.createdAtMs).toBeGreaterThan(0);
  });

  it('handles different adapter shapes opaquely', () => {
    const univer = createTaggingAnchor({
      contentKind: 'univer-block',
      contentId: 'doc-1',
      contentHash: 'h1',
      anchorData: { blockId: 'blk-7', rangeStart: 0, rangeEnd: 50 },
      createdBy: '@a'
    });
    const pdf = createTaggingAnchor({
      contentKind: 'pdf-region',
      contentId: 'doc-2',
      contentHash: 'h2',
      anchorData: { page: 3, bbox: [100, 200, 400, 250] },
      createdBy: '@a'
    });
    expect((getTaggingAnchor(univer.id)!.anchorData as Record<string, unknown>).blockId).toBe(
      'blk-7'
    );
    const pdfBack = getTaggingAnchor(pdf.id)!.anchorData as Record<string, unknown>;
    expect(pdfBack.page).toBe(3);
    expect(pdfBack.bbox).toEqual([100, 200, 400, 250]);
  });
});

describe('listAnchorsForContent', () => {
  it('returns all anchors for a content id, ascending by time', () => {
    createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'doc-1',
      contentHash: 'h1',
      anchorData: { range: 'a' },
      createdBy: '@x'
    });
    createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'doc-1',
      contentHash: 'h1',
      anchorData: { range: 'b' },
      createdBy: '@x'
    });
    createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'doc-2',
      contentHash: 'h2',
      anchorData: { range: 'c' },
      createdBy: '@x'
    });
    const doc1 = listAnchorsForContent('doc-1');
    expect(doc1).toHaveLength(2);
    expect((doc1[0].anchorData as { range: string }).range).toBe('a');
  });

  it('filters by content_kind when provided', () => {
    createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'mixed',
      contentHash: 'h',
      anchorData: {},
      createdBy: '@x'
    });
    createTaggingAnchor({
      contentKind: 'univer-block',
      contentId: 'mixed',
      contentHash: 'h',
      anchorData: {},
      createdBy: '@x'
    });
    expect(listAnchorsForContent('mixed', 'markdown-offset')).toHaveLength(1);
    expect(listAnchorsForContent('mixed', 'univer-block')).toHaveLength(1);
    expect(listAnchorsForContent('mixed')).toHaveLength(2);
  });
});

describe('listStaleAnchors', () => {
  it('returns anchors whose hash differs from the current hash', () => {
    createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'doc-changing',
      contentHash: 'sha256-OLD',
      anchorData: { range: 'a' },
      createdBy: '@x'
    });
    createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'doc-changing',
      contentHash: 'sha256-CURRENT',
      anchorData: { range: 'b' },
      createdBy: '@x'
    });
    const stale = listStaleAnchors('doc-changing', 'sha256-CURRENT');
    expect(stale).toHaveLength(1);
    expect(stale[0].contentHash).toBe('sha256-OLD');
  });
});

// ───────────────────────── runs ─────────────────────────

describe('tagging runs', () => {
  it('starts a run as in-flight (completed_at_ms NULL)', () => {
    const run = startTaggingRun({
      scopeId: 'artefact-X',
      scopeKind: 'artefact',
      initiatorHandle: '@james',
      initiatorKind: 'human',
      runReason: 'periodic re-tag'
    });
    expect(run.id).toMatch(/^trun-/);
    expect(run.completedAtMs).toBeNull();
    expect(run.applicationCount).toBe(0);
  });

  it('completeTaggingRun sets timestamp + counts applications', () => {
    const run = startTaggingRun({
      scopeId: 'artefact-X',
      scopeKind: 'artefact',
      initiatorHandle: '@james',
      initiatorKind: 'human'
    });
    const anchor = createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'artefact-X',
      contentHash: 'h',
      anchorData: {},
      createdBy: '@james'
    });
    applyTag({
      tagId: 'ant.claim.factual',
      tagVersion: 1,
      targetAnchorId: anchor.id,
      applicatorHandle: '@james',
      applicatorKind: 'human',
      taggingRunId: run.id
    });
    applyTag({
      tagId: 'ant.source.primary',
      tagVersion: 1,
      targetAnchorId: anchor.id,
      applicatorHandle: '@james',
      applicatorKind: 'human',
      taggingRunId: run.id
    });
    const completed = completeTaggingRun(run.id);
    expect(completed?.completedAtMs).toBeGreaterThan(0);
    expect(completed?.applicationCount).toBe(2);
  });

  it('completeTaggingRun is idempotent on already-completed runs', () => {
    const run = startTaggingRun({
      scopeId: 'X',
      scopeKind: 'artefact',
      initiatorHandle: '@a',
      initiatorKind: 'human'
    });
    const first = completeTaggingRun(run.id);
    const firstCompletedAt = first?.completedAtMs;
    const second = completeTaggingRun(run.id);
    // Second call returns the existing run unchanged
    expect(second?.completedAtMs).toBe(firstCompletedAt);
  });

  it('listTaggingRuns filters by scope + initiator + in-flight', () => {
    const a = startTaggingRun({
      scopeId: 'doc-1',
      scopeKind: 'document',
      initiatorHandle: '@james',
      initiatorKind: 'human'
    });
    const b = startTaggingRun({
      scopeId: 'doc-2',
      scopeKind: 'document',
      initiatorHandle: '@speedyclaude',
      initiatorKind: 'agent'
    });
    completeTaggingRun(a.id);
    // by scope
    expect(listTaggingRuns({ scopeId: 'doc-1' }).map((r) => r.id)).toEqual([a.id]);
    // by initiator
    expect(listTaggingRuns({ initiatorHandle: '@speedyclaude' }).map((r) => r.id)).toEqual([b.id]);
    // exclude in-flight
    expect(listTaggingRuns({ includeInFlight: false }).map((r) => r.id)).toEqual([a.id]);
  });
});

// ───────────────────────── applyTag guard rails ─────────────────────────

describe('applyTag', () => {
  it('refuses applications against missing anchors', () => {
    const run = startTaggingRun({
      scopeId: 'X',
      scopeKind: 'artefact',
      initiatorHandle: '@a',
      initiatorKind: 'human'
    });
    expect(() =>
      applyTag({
        tagId: 'ant.claim.factual',
        tagVersion: 1,
        targetAnchorId: 'anchor-nope',
        applicatorHandle: '@a',
        applicatorKind: 'human',
        taggingRunId: run.id
      })
    ).toThrow(/anchor anchor-nope does not exist/);
  });

  it('refuses applications against missing runs', () => {
    const anchor = createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'X',
      contentHash: 'h',
      anchorData: {},
      createdBy: '@a'
    });
    expect(() =>
      applyTag({
        tagId: 'ant.claim.factual',
        tagVersion: 1,
        targetAnchorId: anchor.id,
        applicatorHandle: '@a',
        applicatorKind: 'human',
        taggingRunId: 'trun-nope'
      })
    ).toThrow(/tagging run trun-nope does not exist/);
  });

  it('refuses applications against already-completed runs (must start a new run)', () => {
    const run = startTaggingRun({
      scopeId: 'X',
      scopeKind: 'artefact',
      initiatorHandle: '@a',
      initiatorKind: 'human'
    });
    const anchor = createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'X',
      contentHash: 'h',
      anchorData: {},
      createdBy: '@a'
    });
    completeTaggingRun(run.id);
    expect(() =>
      applyTag({
        tagId: 'ant.claim.factual',
        tagVersion: 1,
        targetAnchorId: anchor.id,
        applicatorHandle: '@a',
        applicatorKind: 'human',
        taggingRunId: run.id
      })
    ).toThrow(/already completed/);
  });

  it('records tag_version against each application (replayable audit)', () => {
    const run = startTaggingRun({
      scopeId: 'X',
      scopeKind: 'artefact',
      initiatorHandle: '@a',
      initiatorKind: 'human'
    });
    const anchor = createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'X',
      contentHash: 'h',
      anchorData: {},
      createdBy: '@a'
    });
    const app = applyTag({
      tagId: 'ant.claim.factual',
      tagVersion: 3,
      targetAnchorId: anchor.id,
      applicatorHandle: '@a',
      applicatorKind: 'human',
      taggingRunId: run.id
    });
    const back = getTagApplication(app.id);
    expect(back?.tagVersion).toBe(3);
  });

  it('allows multiple applicators to apply the same tag to the same anchor', () => {
    // The dispute policy resolves disagreement at verify-time —
    // the substrate accepts both.
    const run1 = startTaggingRun({
      scopeId: 'X',
      scopeKind: 'artefact',
      initiatorHandle: '@alice',
      initiatorKind: 'human'
    });
    const run2 = startTaggingRun({
      scopeId: 'X',
      scopeKind: 'artefact',
      initiatorHandle: '@bob',
      initiatorKind: 'human'
    });
    const anchor = createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'X',
      contentHash: 'h',
      anchorData: {},
      createdBy: '@alice'
    });
    applyTag({
      tagId: 'ant.claim.factual',
      tagVersion: 1,
      targetAnchorId: anchor.id,
      applicatorHandle: '@alice',
      applicatorKind: 'human',
      taggingRunId: run1.id
    });
    applyTag({
      tagId: 'ant.claim.factual',
      tagVersion: 1,
      targetAnchorId: anchor.id,
      applicatorHandle: '@bob',
      applicatorKind: 'human',
      taggingRunId: run2.id
    });
    const apps = listApplicationsForAnchor(anchor.id);
    expect(apps).toHaveLength(2);
    expect(apps.map((a) => a.applicatorHandle).sort()).toEqual(['@alice', '@bob']);
  });
});

// ───────────────────────── relational tags ─────────────────────────

describe('relational tag applications', () => {
  it('records target_claim_id for source.supports-claim / refutes-claim shapes', () => {
    const run = startTaggingRun({
      scopeId: 'X',
      scopeKind: 'artefact',
      initiatorHandle: '@a',
      initiatorKind: 'human'
    });
    const sourceAnchor = createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'X',
      contentHash: 'h',
      anchorData: { range: 'source-fragment' },
      createdBy: '@a'
    });
    const app = applyTag({
      tagId: 'ant.source.supports-claim.claim-42',
      tagVersion: 1,
      targetAnchorId: sourceAnchor.id,
      targetClaimId: 'claim-42',
      applicatorHandle: '@a',
      applicatorKind: 'human',
      taggingRunId: run.id
    });
    expect(app.targetClaimId).toBe('claim-42');
    const byClaim = listApplicationsForClaim('claim-42');
    expect(byClaim).toHaveLength(1);
    expect(byClaim[0].tagId).toBe('ant.source.supports-claim.claim-42');
  });

  it('listApplicationsForClaim returns multi-source support correctly', () => {
    const run = startTaggingRun({
      scopeId: 'X',
      scopeKind: 'artefact',
      initiatorHandle: '@a',
      initiatorKind: 'human'
    });
    const a1 = createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'X',
      contentHash: 'h',
      anchorData: { range: 'src1' },
      createdBy: '@a'
    });
    const a2 = createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'X',
      contentHash: 'h',
      anchorData: { range: 'src2' },
      createdBy: '@a'
    });
    applyTag({
      tagId: 'ant.source.supports-claim.c1',
      tagVersion: 1,
      targetAnchorId: a1.id,
      targetClaimId: 'c1',
      applicatorHandle: '@a',
      applicatorKind: 'human',
      taggingRunId: run.id
    });
    applyTag({
      tagId: 'ant.source.refutes-claim.c1',
      tagVersion: 1,
      targetAnchorId: a2.id,
      targetClaimId: 'c1',
      applicatorHandle: '@a',
      applicatorKind: 'human',
      taggingRunId: run.id
    });
    const c1 = listApplicationsForClaim('c1');
    expect(c1).toHaveLength(2);
    expect(c1.map((a) => a.tagId).sort()).toEqual([
      'ant.source.refutes-claim.c1',
      'ant.source.supports-claim.c1'
    ]);
  });
});

// ───────────────────────── append-only invariant ─────────────────────────

describe('append-only invariant', () => {
  it('tag applications are not mutated by re-applying — each call creates a new row', () => {
    const run = startTaggingRun({
      scopeId: 'X',
      scopeKind: 'artefact',
      initiatorHandle: '@a',
      initiatorKind: 'human'
    });
    const anchor = createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'X',
      contentHash: 'h',
      anchorData: {},
      createdBy: '@a'
    });
    const first = applyTag({
      tagId: 'ant.claim.factual',
      tagVersion: 1,
      targetAnchorId: anchor.id,
      applicatorHandle: '@a',
      applicatorKind: 'human',
      taggingRunId: run.id
    });
    const second = applyTag({
      tagId: 'ant.claim.factual',
      tagVersion: 1,
      targetAnchorId: anchor.id,
      applicatorHandle: '@a',
      applicatorKind: 'human',
      taggingRunId: run.id
    });
    expect(first.id).not.toBe(second.id);
    // Both rows present
    const rows = getIdentityDb()
      .prepare(`SELECT COUNT(*) AS c FROM tag_applications WHERE target_anchor_id = ?`)
      .get(anchor.id) as { c: number };
    expect(rows.c).toBe(2);
  });
});

// ───────────────────────── run listings ─────────────────────────

describe('listApplicationsForRun', () => {
  it('groups applications by run for the UI', () => {
    const run = startTaggingRun({
      scopeId: 'X',
      scopeKind: 'artefact',
      initiatorHandle: '@a',
      initiatorKind: 'human'
    });
    const anchor = createTaggingAnchor({
      contentKind: 'markdown-offset',
      contentId: 'X',
      contentHash: 'h',
      anchorData: {},
      createdBy: '@a'
    });
    for (const tag of ['ant.claim.factual', 'ant.source.primary', 'ant.context.technical']) {
      applyTag({
        tagId: tag,
        tagVersion: 1,
        targetAnchorId: anchor.id,
        applicatorHandle: '@a',
        applicatorKind: 'human',
        taggingRunId: run.id
      });
    }
    const apps = listApplicationsForRun(run.id);
    expect(apps).toHaveLength(3);
    expect(apps.map((a) => a.tagId).sort()).toEqual([
      'ant.claim.factual',
      'ant.context.technical',
      'ant.source.primary'
    ]);
  });
});

describe('getTaggingRun', () => {
  it('returns null for missing runs (no throw)', () => {
    expect(getTaggingRun('trun-does-not-exist')).toBeNull();
  });
});
