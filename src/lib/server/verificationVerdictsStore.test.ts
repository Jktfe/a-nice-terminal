import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createValidationSchema } from './validationLensStore';
import { getIdentityDb } from './db';
import {
  getEffectiveVerdict,
  getVerdict,
  listDisputesForLens,
  listVerdictChain,
  listVerdictsByVerifier,
  recordVerdict,
  resetVerificationVerdictsStoreForTests
} from './verificationVerdictsStore';

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
  resetVerificationVerdictsStoreForTests();
  getIdentityDb().prepare('DELETE FROM verification_lenses').run();
});

afterEach(() => {
  resetVerificationVerdictsStoreForTests();
  getIdentityDb().prepare('DELETE FROM verification_lenses').run();
});

describe('recordVerdict — basic', () => {
  it('records a passed verdict with started_at_ms = completed_at_ms (terminal state)', () => {
    const lens = freshLens('lens-1');
    const v = recordVerdict({
      lensId: lens.id,
      claimAnchor: 'artefact:doc-1#para-3',
      claimText: 'Revenue grew 30% in Q3',
      status: 'passed',
      score: 95,
      verifierHandle: '@james',
      verifierKind: 'human'
    });
    expect(v.status).toBe('passed');
    expect(v.completedAtMs).toBe(v.startedAtMs);
    expect(v.verifierHandle).toBe('@james');
    expect(v.parentObservationId).toBeNull();
  });

  it('records a pending verdict with completed_at_ms NULL (in-flight)', () => {
    const lens = freshLens('lens-pending');
    const v = recordVerdict({
      lensId: lens.id,
      claimAnchor: 'artefact:doc-1#p1',
      claimText: 'placeholder',
      status: 'pending',
      verifierHandle: '@agent',
      verifierKind: 'agent'
    });
    expect(v.status).toBe('pending');
    expect(v.completedAtMs).toBeNull();
  });

  it('refuses orphan verdicts (lens does not exist)', () => {
    expect(() =>
      recordVerdict({
        lensId: 'lens-nope',
        claimAnchor: 'x',
        claimText: 't',
        status: 'passed',
        verifierHandle: '@a',
        verifierKind: 'human'
      })
    ).toThrow(/lens lens-nope does not exist/);
  });

  it('refuses dispute without disputeReason', () => {
    const lens = freshLens('lens-dispute');
    expect(() =>
      recordVerdict({
        lensId: lens.id,
        claimAnchor: 'x',
        claimText: 't',
        status: 'dispute',
        verifierHandle: '@a',
        verifierKind: 'human'
      })
    ).toThrow(/dispute status requires disputeReason/);
  });

  it('records dispute with reason captured', () => {
    const lens = freshLens('lens-dr');
    const v = recordVerdict({
      lensId: lens.id,
      claimAnchor: 'x',
      claimText: 't',
      status: 'dispute',
      disputeReason: 'sources contradict',
      verifierHandle: '@a',
      verifierKind: 'human'
    });
    expect(v.status).toBe('dispute');
    expect(v.disputeReason).toBe('sources contradict');
  });
});

describe('chain semantics', () => {
  it('parent_observation_id links sequential observations for the same claim', () => {
    const lens = freshLens('lens-chain');
    const first = recordVerdict({
      lensId: lens.id,
      claimAnchor: 'c1',
      claimText: 'claim',
      status: 'pending',
      verifierHandle: '@a',
      verifierKind: 'agent'
    });
    const second = recordVerdict({
      lensId: lens.id,
      claimAnchor: 'c1',
      claimText: 'claim',
      status: 'passed',
      parentObservationId: first.id,
      verifierHandle: '@a',
      verifierKind: 'agent'
    });
    expect(second.parentObservationId).toBe(first.id);
    const chain = listVerdictChain(lens.id, 'c1');
    expect(chain).toHaveLength(2);
    expect(chain[0].id).toBe(second.id); // newest-first
    expect(chain[1].id).toBe(first.id);
  });

  it('refuses parent that points to a different (lens, claim) pair', () => {
    const lens = freshLens('lens-x');
    const otherClaim = recordVerdict({
      lensId: lens.id,
      claimAnchor: 'other-claim',
      claimText: 't',
      status: 'passed',
      verifierHandle: '@a',
      verifierKind: 'agent'
    });
    expect(() =>
      recordVerdict({
        lensId: lens.id,
        claimAnchor: 'this-claim', // different claim
        claimText: 't',
        status: 'passed',
        parentObservationId: otherClaim.id,
        verifierHandle: '@a',
        verifierKind: 'agent'
      })
    ).toThrow(/different \(lens, claim\) pair/);
  });

  it('refuses parent that does not exist', () => {
    const lens = freshLens('lens-y');
    expect(() =>
      recordVerdict({
        lensId: lens.id,
        claimAnchor: 'c',
        claimText: 't',
        status: 'passed',
        parentObservationId: 'vobs-nope',
        verifierHandle: '@a',
        verifierKind: 'agent'
      })
    ).toThrow(/parent observation .* does not exist/);
  });
});

describe('getEffectiveVerdict', () => {
  it('returns null when no observations exist', () => {
    const lens = freshLens('lens-empty');
    expect(getEffectiveVerdict(lens.id, 'c-no-obs')).toBeNull();
  });

  it('returns the most recent verdict in the chain', () => {
    const lens = freshLens('lens-eff');
    recordVerdict({
      lensId: lens.id,
      claimAnchor: 'c',
      claimText: 't',
      status: 'pending',
      verifierHandle: '@a',
      verifierKind: 'agent'
    });
    recordVerdict({
      lensId: lens.id,
      claimAnchor: 'c',
      claimText: 't',
      status: 'failed',
      verifierHandle: '@a',
      verifierKind: 'agent'
    });
    recordVerdict({
      lensId: lens.id,
      claimAnchor: 'c',
      claimText: 't',
      status: 'passed',
      verifierHandle: '@b',
      verifierKind: 'human'
    });
    const eff = getEffectiveVerdict(lens.id, 'c');
    expect(eff?.status).toBe('passed');
    expect(eff?.verifierHandle).toBe('@b');
  });

  it('isolates verdicts per (lens, claim) pair', () => {
    const a = freshLens('lens-iso-a');
    const b = freshLens('lens-iso-b');
    recordVerdict({
      lensId: a.id, claimAnchor: 'c', claimText: 't',
      status: 'passed', verifierHandle: '@x', verifierKind: 'agent'
    });
    recordVerdict({
      lensId: b.id, claimAnchor: 'c', claimText: 't',
      status: 'failed', verifierHandle: '@x', verifierKind: 'agent'
    });
    expect(getEffectiveVerdict(a.id, 'c')?.status).toBe('passed');
    expect(getEffectiveVerdict(b.id, 'c')?.status).toBe('failed');
  });
});

describe('listVerdictsByVerifier', () => {
  it('returns verdicts authored by a verifier, newest-first', () => {
    const lens = freshLens('lens-byv');
    recordVerdict({
      lensId: lens.id, claimAnchor: 'c1', claimText: 't',
      status: 'passed', verifierHandle: '@alice', verifierKind: 'human'
    });
    recordVerdict({
      lensId: lens.id, claimAnchor: 'c2', claimText: 't',
      status: 'passed', verifierHandle: '@bob', verifierKind: 'human'
    });
    recordVerdict({
      lensId: lens.id, claimAnchor: 'c3', claimText: 't',
      status: 'failed', verifierHandle: '@alice', verifierKind: 'human'
    });
    const alice = listVerdictsByVerifier('@alice');
    expect(alice).toHaveLength(2);
    expect(alice[0].status).toBe('failed'); // newest
  });

  it('caps at the supplied limit', () => {
    const lens = freshLens('lens-cap');
    for (let i = 0; i < 5; i++) {
      recordVerdict({
        lensId: lens.id, claimAnchor: `c${i}`, claimText: 't',
        status: 'passed', verifierHandle: '@v', verifierKind: 'agent'
      });
    }
    expect(listVerdictsByVerifier('@v', 3)).toHaveLength(3);
  });
});

describe('listDisputesForLens', () => {
  it('returns only dispute-status rows for a lens', () => {
    const lens = freshLens('lens-d');
    recordVerdict({
      lensId: lens.id, claimAnchor: 'c1', claimText: 't',
      status: 'passed', verifierHandle: '@a', verifierKind: 'agent'
    });
    recordVerdict({
      lensId: lens.id, claimAnchor: 'c2', claimText: 't',
      status: 'dispute', disputeReason: 'conflict',
      verifierHandle: '@a', verifierKind: 'agent'
    });
    recordVerdict({
      lensId: lens.id, claimAnchor: 'c3', claimText: 't',
      status: 'failed', verifierHandle: '@a', verifierKind: 'agent'
    });
    const disputes = listDisputesForLens(lens.id);
    expect(disputes).toHaveLength(1);
    expect(disputes[0].claimAnchor).toBe('c2');
  });
});

describe('new verdict values', () => {
  it('insufficient_evidence verdict persists with result_json trace', () => {
    const lens = freshLens('lens-ie');
    const v = recordVerdict({
      lensId: lens.id,
      claimAnchor: 'c',
      claimText: 'claim needing sources',
      status: 'insufficient_evidence',
      resultJson: JSON.stringify({ sourcesChecked: 3, threshold: 5 }),
      verifierHandle: '@agent',
      verifierKind: 'agent'
    });
    expect(v.status).toBe('insufficient_evidence');
    const back = getVerdict(v.id);
    expect(JSON.parse(back!.resultJson!)).toEqual({ sourcesChecked: 3, threshold: 5 });
  });

  it('retag_required verdict signals tag staleness without scoring', () => {
    const lens = freshLens('lens-rt');
    const v = recordVerdict({
      lensId: lens.id,
      claimAnchor: 'c',
      claimText: 't',
      status: 'retag_required',
      verifierHandle: '@agent',
      verifierKind: 'agent'
    });
    expect(v.status).toBe('retag_required');
    expect(v.completedAtMs).toBe(v.startedAtMs);
  });
});

describe('append-only invariant', () => {
  it('no UPDATE path — recording a new verdict always creates a new row', () => {
    const lens = freshLens('lens-ao');
    const first = recordVerdict({
      lensId: lens.id, claimAnchor: 'c', claimText: 't',
      status: 'passed', verifierHandle: '@a', verifierKind: 'agent'
    });
    const second = recordVerdict({
      lensId: lens.id, claimAnchor: 'c', claimText: 't',
      status: 'passed', verifierHandle: '@a', verifierKind: 'agent'
    });
    expect(first.id).not.toBe(second.id);
    const count = getIdentityDb()
      .prepare(`SELECT COUNT(*) AS c FROM verification_observations WHERE lens_id = ?`)
      .get(lens.id) as { c: number };
    expect(count.c).toBe(2);
  });
});
