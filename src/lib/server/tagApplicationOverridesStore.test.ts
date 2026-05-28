import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyTag,
  createTaggingAnchor,
  resetTagApplicationsStoreForTests,
  startTaggingRun
} from './tagApplicationsStore';
import type { TagApplication } from './tagApplicationsStore';
import {
  getEffectiveOverride,
  listOverridesByHandler,
  listOverridesForApplication,
  recordTagApplicationOverride,
  resetTagApplicationOverridesStoreForTests
} from './tagApplicationOverridesStore';

function freshApplication(): TagApplication {
  const run = startTaggingRun({
    scopeId: 'X',
    scopeKind: 'artefact',
    initiatorHandle: '@x',
    initiatorKind: 'human'
  });
  const anchor = createTaggingAnchor({
    contentKind: 'markdown-offset',
    contentId: 'X',
    contentHash: 'h',
    anchorData: {},
    createdBy: '@x'
  });
  return applyTag({
    tagId: 'ant.claim.factual',
    tagVersion: 1,
    targetAnchorId: anchor.id,
    applicatorHandle: '@x',
    applicatorKind: 'human',
    taggingRunId: run.id
  });
}

beforeEach(() => {
  resetTagApplicationOverridesStoreForTests();
  resetTagApplicationsStoreForTests();
});

afterEach(() => {
  resetTagApplicationOverridesStoreForTests();
  resetTagApplicationsStoreForTests();
});

describe('recordTagApplicationOverride — input validation', () => {
  it('refuses missing reason', () => {
    const app = freshApplication();
    expect(() =>
      recordTagApplicationOverride({
        tagApplicationId: app.id,
        overrideKind: 'flag_ignorable',
        handlerHandle: '@james',
        handlerKind: 'human',
        reason: ''
      })
    ).toThrow(/reason is required/);
  });

  it('refuses whitespace-only reason (audit-of-flagger discipline)', () => {
    const app = freshApplication();
    expect(() =>
      recordTagApplicationOverride({
        tagApplicationId: app.id,
        overrideKind: 'flag_ignorable',
        handlerHandle: '@james',
        handlerKind: 'human',
        reason: '   '
      })
    ).toThrow(/reason is required/);
  });

  it('refuses classification override without newProtocolClass', () => {
    const app = freshApplication();
    expect(() =>
      recordTagApplicationOverride({
        tagApplicationId: app.id,
        overrideKind: 'classification',
        handlerHandle: '@james',
        handlerKind: 'human',
        reason: 'demote'
      })
    ).toThrow(/newProtocolClass required/);
  });

  it('refuses newProtocolClass on non-classification override', () => {
    const app = freshApplication();
    expect(() =>
      recordTagApplicationOverride({
        tagApplicationId: app.id,
        overrideKind: 'flag_ignorable',
        newProtocolClass: 'heuristic',
        handlerHandle: '@james',
        handlerKind: 'human',
        reason: 'joke'
      })
    ).toThrow(/only valid for kind='classification'/);
  });

  it('refuses override against missing tag_application', () => {
    expect(() =>
      recordTagApplicationOverride({
        tagApplicationId: 'tapp-nope',
        overrideKind: 'flag_ignorable',
        handlerHandle: '@james',
        handlerKind: 'human',
        reason: 'r'
      })
    ).toThrow(/does not exist/);
  });

  it('trims surrounding whitespace from reason', () => {
    const app = freshApplication();
    const ov = recordTagApplicationOverride({
      tagApplicationId: app.id,
      overrideKind: 'flag_ignorable',
      handlerHandle: '@james',
      handlerKind: 'human',
      reason: '  this is a joke claim  '
    });
    expect(ov.reason).toBe('this is a joke claim');
  });
});

describe('classification overrides', () => {
  it('records new_protocol_class on classification override', () => {
    const app = freshApplication();
    const ov = recordTagApplicationOverride({
      tagApplicationId: app.id,
      overrideKind: 'classification',
      newProtocolClass: 'heuristic',
      handlerHandle: '@james',
      handlerKind: 'human',
      reason: 'context warrants heuristic, not consensus'
    });
    expect(ov.newProtocolClass).toBe('heuristic');
    const eff = getEffectiveOverride(app.id);
    expect(eff?.kind).toBe('classification');
    expect((eff as { newProtocolClass: string }).newProtocolClass).toBe('heuristic');
  });
});

describe('flag_ignorable overrides', () => {
  it('flags an application as ignorable; effective override is flag_ignorable', () => {
    const app = freshApplication();
    recordTagApplicationOverride({
      tagApplicationId: app.id,
      overrideKind: 'flag_ignorable',
      handlerHandle: '@james',
      handlerKind: 'human',
      reason: 'this is a joke claim, not a real one'
    });
    const eff = getEffectiveOverride(app.id);
    expect(eff?.kind).toBe('flag_ignorable');
  });
});

describe('withdraw + override chain', () => {
  it('returns null when no overrides exist', () => {
    const app = freshApplication();
    expect(getEffectiveOverride(app.id)).toBeNull();
  });

  it('withdraw cancels the most recent override; reveals null when sole', () => {
    const app = freshApplication();
    recordTagApplicationOverride({
      tagApplicationId: app.id,
      overrideKind: 'flag_ignorable',
      handlerHandle: '@a',
      handlerKind: 'human',
      reason: 'first try'
    });
    recordTagApplicationOverride({
      tagApplicationId: app.id,
      overrideKind: 'withdraw',
      handlerHandle: '@a',
      handlerKind: 'human',
      reason: 'changed mind'
    });
    expect(getEffectiveOverride(app.id)).toBeNull();
  });

  it('withdraw reveals the prior override in the chain', () => {
    const app = freshApplication();
    // Step 1: classification override (heuristic)
    recordTagApplicationOverride({
      tagApplicationId: app.id,
      overrideKind: 'classification',
      newProtocolClass: 'heuristic',
      handlerHandle: '@a',
      handlerKind: 'human',
      reason: 'demote step 1'
    });
    // Step 2: flag_ignorable
    recordTagApplicationOverride({
      tagApplicationId: app.id,
      overrideKind: 'flag_ignorable',
      handlerHandle: '@a',
      handlerKind: 'human',
      reason: 'actually a joke'
    });
    // Step 3: withdraw the flag_ignorable
    recordTagApplicationOverride({
      tagApplicationId: app.id,
      overrideKind: 'withdraw',
      handlerHandle: '@a',
      handlerKind: 'human',
      reason: 'no it is a real claim'
    });
    // Effective: classification (heuristic) from step 1
    const eff = getEffectiveOverride(app.id);
    expect(eff?.kind).toBe('classification');
    expect((eff as { newProtocolClass: string }).newProtocolClass).toBe('heuristic');
  });

  it('stacked withdraws pop multiple prior overrides', () => {
    const app = freshApplication();
    recordTagApplicationOverride({
      tagApplicationId: app.id,
      overrideKind: 'flag_ignorable',
      handlerHandle: '@a',
      handlerKind: 'human',
      reason: 'first'
    });
    recordTagApplicationOverride({
      tagApplicationId: app.id,
      overrideKind: 'classification',
      newProtocolClass: 'heuristic',
      handlerHandle: '@a',
      handlerKind: 'human',
      reason: 'second'
    });
    // Two withdraws → both prior overrides cancelled → null
    recordTagApplicationOverride({
      tagApplicationId: app.id,
      overrideKind: 'withdraw',
      handlerHandle: '@a',
      handlerKind: 'human',
      reason: 'undo two'
    });
    recordTagApplicationOverride({
      tagApplicationId: app.id,
      overrideKind: 'withdraw',
      handlerHandle: '@a',
      handlerKind: 'human',
      reason: 'undo one'
    });
    expect(getEffectiveOverride(app.id)).toBeNull();
  });
});

describe('append-only invariant', () => {
  it('listOverridesForApplication returns full chain newest-first', () => {
    const app = freshApplication();
    recordTagApplicationOverride({
      tagApplicationId: app.id,
      overrideKind: 'flag_ignorable',
      handlerHandle: '@a',
      handlerKind: 'human',
      reason: 'r1'
    });
    recordTagApplicationOverride({
      tagApplicationId: app.id,
      overrideKind: 'withdraw',
      handlerHandle: '@a',
      handlerKind: 'human',
      reason: 'r2'
    });
    recordTagApplicationOverride({
      tagApplicationId: app.id,
      overrideKind: 'classification',
      newProtocolClass: 'judgement-required',
      handlerHandle: '@a',
      handlerKind: 'human',
      reason: 'r3'
    });
    const chain = listOverridesForApplication(app.id);
    expect(chain).toHaveLength(3);
    expect(chain.map((o) => o.reason)).toEqual(['r3', 'r2', 'r1']);
  });
});

describe('listOverridesByHandler', () => {
  it('returns overrides created by a specific handler, newest-first', () => {
    const app1 = freshApplication();
    const app2 = freshApplication();
    recordTagApplicationOverride({
      tagApplicationId: app1.id,
      overrideKind: 'flag_ignorable',
      handlerHandle: '@james',
      handlerKind: 'human',
      reason: 'a'
    });
    recordTagApplicationOverride({
      tagApplicationId: app2.id,
      overrideKind: 'flag_ignorable',
      handlerHandle: '@other',
      handlerKind: 'human',
      reason: 'b'
    });
    recordTagApplicationOverride({
      tagApplicationId: app2.id,
      overrideKind: 'flag_ignorable',
      handlerHandle: '@james',
      handlerKind: 'human',
      reason: 'c'
    });
    const james = listOverridesByHandler('@james');
    expect(james).toHaveLength(2);
    expect(james.map((o) => o.reason)).toEqual(['c', 'a']);
  });

  it('respects limit option', () => {
    const app = freshApplication();
    for (let i = 0; i < 5; i++) {
      recordTagApplicationOverride({
        tagApplicationId: app.id,
        overrideKind: 'flag_ignorable',
        handlerHandle: '@james',
        handlerKind: 'human',
        reason: `r${i}`
      });
      recordTagApplicationOverride({
        tagApplicationId: app.id,
        overrideKind: 'withdraw',
        handlerHandle: '@james',
        handlerKind: 'human',
        reason: `w${i}`
      });
    }
    const limited = listOverridesByHandler('@james', { limit: 3 });
    expect(limited).toHaveLength(3);
  });
});
