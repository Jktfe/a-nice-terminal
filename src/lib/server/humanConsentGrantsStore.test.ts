import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests, getIdentityDb } from './db';
import { createOwner } from './ownersStore';
import {
  consumeHumanConsentGrant,
  createHumanConsentGrant,
  findActiveGrantForOwnerAndTerminal,
  findHumanConsentGrantById,
  listGrantsForOwner,
  revokeHumanConsentGrant
} from './humanConsentGrantsStore';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});

function auditFor(grantId: string): string[] {
  // ORDER BY rowid for insertion order — UUID ids are not chronological.
  const rows = getIdentityDb()
    .prepare(`SELECT action FROM human_consent_grant_audit WHERE grant_id = ? ORDER BY rowid ASC`)
    .all(grantId) as { action: string }[];
  return rows.map((r) => r.action);
}

describe('humanConsentGrantsStore', () => {
  it('creates a grant in active status and writes a created audit row', () => {
    const owner = createOwner({ handle: '@you', password: 'pw' });
    const grant = createHumanConsentGrant({
      ownerId: owner.id,
      grantedToTerminalId: 't_claude',
      grantedToHandle: '@you',
      createdByTerminalId: 't_human',
      durationMs: 30 * 60_000,
      maxUses: 5
    });
    expect(grant.status).toBe('active');
    expect(grant.usesConsumed).toBe(0);
    expect(grant.maxUses).toBe(5);
    expect(auditFor(grant.id)).toEqual(['created']);
  });

  it('consumes one grant unit per accepted post and transitions to exhausted on the last use', () => {
    const owner = createOwner({ handle: '@you', password: 'pw' });
    const grant = createHumanConsentGrant({
      ownerId: owner.id,
      grantedToTerminalId: 't_claude',
      grantedToHandle: '@you',
      createdByTerminalId: 't_human',
      durationMs: 30 * 60_000,
      maxUses: 2
    });
    expect(consumeHumanConsentGrant({ grantId: grant.id, messageId: 'm1', actorHandle: '@you', actorTerminalId: 't_claude' })).toBe('ok');
    expect(findHumanConsentGrantById(grant.id)?.status).toBe('active');
    expect(consumeHumanConsentGrant({ grantId: grant.id, messageId: 'm2', actorHandle: '@you', actorTerminalId: 't_claude' })).toBe('ok');
    expect(findHumanConsentGrantById(grant.id)?.status).toBe('exhausted');
    expect(consumeHumanConsentGrant({ grantId: grant.id, messageId: 'm3', actorHandle: '@you', actorTerminalId: 't_claude' })).toBe('exhausted');
    expect(auditFor(grant.id)).toEqual(['created', 'consumed', 'consumed', 'exhausted']);
  });

  it('expires a grant when TTL elapses and refuses further consumption', () => {
    const owner = createOwner({ handle: '@you', password: 'pw' });
    const now = 1_700_000_000_000;
    const grant = createHumanConsentGrant({
      ownerId: owner.id,
      grantedToTerminalId: 't_claude',
      grantedToHandle: '@you',
      createdByTerminalId: 't_human',
      durationMs: 60_000,
      maxUses: 10,
      nowMs: now
    });
    expect(consumeHumanConsentGrant({ grantId: grant.id, messageId: 'm1', actorHandle: '@you', actorTerminalId: 't_claude', nowMs: now + 30_000 })).toBe('ok');
    expect(consumeHumanConsentGrant({ grantId: grant.id, messageId: 'm2', actorHandle: '@you', actorTerminalId: 't_claude', nowMs: now + 60_001 })).toBe('expired');
    expect(findHumanConsentGrantById(grant.id)?.status).toBe('expired');
  });

  it('revoke is idempotent and refuses further consumption', () => {
    const owner = createOwner({ handle: '@you', password: 'pw' });
    const grant = createHumanConsentGrant({
      ownerId: owner.id,
      grantedToTerminalId: 't_claude',
      grantedToHandle: '@you',
      createdByTerminalId: 't_human',
      durationMs: 30 * 60_000,
      maxUses: 5
    });
    revokeHumanConsentGrant({ grantId: grant.id, revokedByHandle: '@you' });
    expect(findHumanConsentGrantById(grant.id)?.status).toBe('revoked');
    revokeHumanConsentGrant({ grantId: grant.id, revokedByHandle: '@you' });
    expect(findHumanConsentGrantById(grant.id)?.status).toBe('revoked');
    expect(consumeHumanConsentGrant({ grantId: grant.id, messageId: 'm1', actorHandle: '@you', actorTerminalId: 't_claude' })).toBe('revoked');
  });

  it('findActiveGrantForOwnerAndTerminal returns the most recent active grant and auto-expires stale rows', () => {
    const owner = createOwner({ handle: '@you', password: 'pw' });
    const now = 1_700_000_000_000;
    createHumanConsentGrant({
      ownerId: owner.id,
      grantedToTerminalId: 't_claude',
      grantedToHandle: '@you',
      createdByTerminalId: 't_human',
      durationMs: 60_000,
      maxUses: null,
      nowMs: now
    });
    const fresh = createHumanConsentGrant({
      ownerId: owner.id,
      grantedToTerminalId: 't_claude',
      grantedToHandle: '@you',
      createdByTerminalId: 't_human',
      durationMs: null,
      maxUses: null,
      nowMs: now + 60_000
    });
    const result = findActiveGrantForOwnerAndTerminal({
      ownerId: owner.id,
      grantedToTerminalId: 't_claude',
      nowMs: now + 120_000
    });
    expect(result?.id).toBe(fresh.id);
  });

  it('consume stress-loop on max_uses=5 produces exactly 5 consumed + 1 exhausted audit rows (SQL-side filter)', () => {
    // Regression for task #31: consumeHumanConsentGrant pushes the
    // active-only check into the UPDATE WHERE clause so that an
    // already-exhausted grant matches 0 rows and no extra audit row is
    // written. 100 calls on a max_uses=5 grant must produce exactly
    // 5 'consumed' transitions, 1 'exhausted' transition, and a final
    // status of 'exhausted' — the remaining 94 calls match zero rows.
    const owner = createOwner({ handle: '@you', password: 'pw' });
    const grant = createHumanConsentGrant({
      ownerId: owner.id,
      grantedToTerminalId: 't_claude',
      grantedToHandle: '@you',
      createdByTerminalId: 't_human',
      durationMs: 30 * 60_000,
      maxUses: 5
    });
    const returns: string[] = [];
    for (let i = 0; i < 100; i++) {
      returns.push(
        consumeHumanConsentGrant({
          grantId: grant.id,
          messageId: `m${i}`,
          actorHandle: '@you',
          actorTerminalId: 't_claude'
        })
      );
    }
    expect(findHumanConsentGrantById(grant.id)?.status).toBe('exhausted');
    const actions = auditFor(grant.id);
    expect(actions.filter((a) => a === 'consumed').length).toBe(5);
    expect(actions.filter((a) => a === 'exhausted').length).toBe(1);
    expect(actions).toEqual([
      'created',
      'consumed', 'consumed', 'consumed', 'consumed', 'consumed',
      'exhausted'
    ]);
    expect(returns.filter((r) => r === 'ok').length).toBe(5);
    expect(returns.filter((r) => r === 'exhausted').length).toBe(95);
  });

  it('revoke stress-loop produces exactly one revoked audit row (txn covers SELECT+UPDATE)', () => {
    // Regression for task #30: revokeHumanConsentGrant wraps the
    // SELECT-then-UPDATE in db.transaction(), so re-entrant calls on the
    // same grant see the post-revoke status on the SELECT and skip the
    // UPDATE+audit-write. better-sqlite3 is synchronous, so this loop
    // exercises serial re-entry, not true concurrency — but it pins the
    // contract that "N revoke calls produce exactly one 'revoked' audit
    // row" which is the property the txn guarantees.
    const owner = createOwner({ handle: '@you', password: 'pw' });
    const grant = createHumanConsentGrant({
      ownerId: owner.id,
      grantedToTerminalId: 't_claude',
      grantedToHandle: '@you',
      createdByTerminalId: 't_human',
      durationMs: 30 * 60_000,
      maxUses: 5
    });
    for (let i = 0; i < 100; i++) {
      revokeHumanConsentGrant({ grantId: grant.id, revokedByHandle: '@you' });
    }
    expect(findHumanConsentGrantById(grant.id)?.status).toBe('revoked');
    const actions = auditFor(grant.id);
    expect(actions.filter((a) => a === 'revoked').length).toBe(1);
    expect(actions).toEqual(['created', 'revoked']);
  });

  it('listGrantsForOwner returns active grants by default and all on includeInactive', () => {
    const owner = createOwner({ handle: '@you', password: 'pw' });
    const a = createHumanConsentGrant({
      ownerId: owner.id, grantedToTerminalId: 't1', grantedToHandle: '@you',
      createdByTerminalId: 't_h', durationMs: null, maxUses: 1
    });
    consumeHumanConsentGrant({ grantId: a.id, messageId: 'm', actorHandle: '@you', actorTerminalId: 't1' });
    createHumanConsentGrant({
      ownerId: owner.id, grantedToTerminalId: 't2', grantedToHandle: '@you',
      createdByTerminalId: 't_h', durationMs: null, maxUses: null
    });
    expect(listGrantsForOwner({ ownerId: owner.id }).length).toBe(1);
    expect(listGrantsForOwner({ ownerId: owner.id, includeInactive: true }).length).toBe(2);
  });
});
