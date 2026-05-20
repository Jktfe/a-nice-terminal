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
