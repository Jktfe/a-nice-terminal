import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests, getIdentityDb } from './db';
import { createOwner } from './ownersStore';
import {
  createHumanConsentGrant,
  revokeHumanConsentGrant
} from './humanConsentGrantsStore';
import {
  checkHumanImpersonationConsent,
  gateAndConsumeForWrite,
  resolveHumanOwnership,
  requireHumanImpersonationConsent
} from './consentGate';

function bindOwnerSelfTerminal(handle: string, terminalId: string): void {
  // Simulates "this terminal IS the human's own terminal" — the room_memberships
  // row that the self-post carve-out keys on. Needs a terminals row first
  // (room_memberships.terminal_id has a FK to terminals.id).
  const now = Date.now();
  getIdentityDb()
    .prepare(`INSERT OR IGNORE INTO terminals (id, pid, name, created_at, updated_at) VALUES (?, 0, ?, ?, ?)`)
    .run(terminalId, `self-${terminalId}`, now, now);
  getIdentityDb()
    .prepare(
      `INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at)
       VALUES (?, 'room_dummy', ?, ?, ?)`
    )
    .run(`mem-${terminalId}-${handle}`, handle, terminalId, now);
}

function caughtMessage(fn: () => unknown): string {
  try { fn(); return ''; }
  catch (e: unknown) {
    const err = e as { body?: { message?: string }; message?: string };
    return err?.body?.message ?? err?.message ?? '';
  }
}

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});

describe('resolveHumanOwnership', () => {
  it('returns agent kind for unknown handles', () => {
    expect(resolveHumanOwnership('@codex')).toEqual({ kind: 'agent' });
    expect(resolveHumanOwnership('')).toEqual({ kind: 'agent' });
  });

  it('returns agent kind for @browser-bs_* ephemera', () => {
    expect(resolveHumanOwnership('@browser-bs_abc123')).toEqual({ kind: 'agent' });
  });

  it('returns human kind with owner_id for registered handles', () => {
    const owner = createOwner({ handle: '@james', password: 'hunter2pw' });
    const result = resolveHumanOwnership('@james');
    expect(result).toEqual({ kind: 'human', ownerId: owner.id });
  });

  it('resolves aliases to the same owner_id after a rename', () => {
    const owner = createOwner({ handle: '@you', password: 'pw' });
    // rename adds @me as new primary, keeps @you as alias
    getIdentityDb()
      .prepare(`INSERT INTO owner_handles (owner_id, handle, is_primary, assigned_at_ms) VALUES (?, '@me', 0, ?)`)
      .run(owner.id, Date.now());
    expect(resolveHumanOwnership('@you').kind).toBe('human');
    expect(resolveHumanOwnership('@me').kind).toBe('human');
    if (resolveHumanOwnership('@you').kind === 'human' && resolveHumanOwnership('@me').kind === 'human') {
      const a = resolveHumanOwnership('@you');
      const b = resolveHumanOwnership('@me');
      if (a.kind === 'human' && b.kind === 'human') expect(a.ownerId).toBe(b.ownerId);
    }
  });
});

describe('checkHumanImpersonationConsent', () => {
  it('returns selfPost when caller terminal is the owner own terminal', () => {
    const owner = createOwner({ handle: '@james', password: 'pw' });
    bindOwnerSelfTerminal('@james', 't_james_own');
    const result = checkHumanImpersonationConsent({
      ownerId: owner.id,
      callerTerminalId: 't_james_own'
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.selfPost).toBe(true);
  });

  it('returns allowed grant when an active grant matches caller terminal', () => {
    const owner = createOwner({ handle: '@james', password: 'pw' });
    const grant = createHumanConsentGrant({
      ownerId: owner.id,
      grantedToTerminalId: 't_claude',
      grantedToHandle: '@james',
      createdByTerminalId: 't_james_own',
      durationMs: 30 * 60_000,
      maxUses: 5
    });
    const result = checkHumanImpersonationConsent({
      ownerId: owner.id,
      callerTerminalId: 't_claude'
    });
    expect(result.allowed).toBe(true);
    if (result.allowed && !result.selfPost) expect(result.grant.id).toBe(grant.id);
  });

  it('denies no_grant when caller terminal has no active grant', () => {
    const owner = createOwner({ handle: '@james', password: 'pw' });
    const result = checkHumanImpersonationConsent({
      ownerId: owner.id,
      callerTerminalId: 't_stranger'
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('no_grant');
  });

  it('denies after revoke', () => {
    const owner = createOwner({ handle: '@james', password: 'pw' });
    const grant = createHumanConsentGrant({
      ownerId: owner.id, grantedToTerminalId: 't_claude', grantedToHandle: '@james',
      createdByTerminalId: 't_human', durationMs: 30 * 60_000, maxUses: 5
    });
    revokeHumanConsentGrant({ grantId: grant.id, revokedByHandle: '@james' });
    const result = checkHumanImpersonationConsent({
      ownerId: owner.id, callerTerminalId: 't_claude'
    });
    expect(result.allowed).toBe(false);
  });
});

describe('requireHumanImpersonationConsent', () => {
  it('throws 403 with structured reason on no grant', () => {
    const owner = createOwner({ handle: '@james', password: 'pw' });
    expect(caughtMessage(() => requireHumanImpersonationConsent({
      ownerId: owner.id, callerTerminalId: 't_no_grant'
    }))).toMatch(/human_impersonation_no_grant/);
  });
});

describe('gateAndConsumeForWrite', () => {
  it('returns null grantId for self-post', () => {
    const owner = createOwner({ handle: '@james', password: 'pw' });
    bindOwnerSelfTerminal('@james', 't_james_own');
    const out = gateAndConsumeForWrite({
      ownerId: owner.id,
      callerTerminalId: 't_james_own',
      callerHandle: '@james',
      messageId: 'msg_self_1'
    });
    expect(out.grantId).toBeNull();
  });

  it('consumes one grant unit and returns the grant_id on grant-based write', () => {
    const owner = createOwner({ handle: '@james', password: 'pw' });
    const grant = createHumanConsentGrant({
      ownerId: owner.id, grantedToTerminalId: 't_claude', grantedToHandle: '@james',
      createdByTerminalId: 't_human', durationMs: 30 * 60_000, maxUses: 2
    });
    const out = gateAndConsumeForWrite({
      ownerId: owner.id, callerTerminalId: 't_claude',
      callerHandle: '@james', messageId: 'msg_g_1'
    });
    expect(out.grantId).toBe(grant.id);
    const audit = getIdentityDb()
      .prepare(`SELECT action, message_id FROM human_consent_grant_audit WHERE grant_id = ? ORDER BY rowid`)
      .all(grant.id) as { action: string; message_id: string | null }[];
    expect(audit).toEqual([
      { action: 'created', message_id: null },
      { action: 'consumed', message_id: 'msg_g_1' }
    ]);
  });

  it('throws 403 with reason on exhausted grant', () => {
    const owner = createOwner({ handle: '@james', password: 'pw' });
    createHumanConsentGrant({
      ownerId: owner.id, grantedToTerminalId: 't_claude', grantedToHandle: '@james',
      createdByTerminalId: 't_human', durationMs: 30 * 60_000, maxUses: 1
    });
    gateAndConsumeForWrite({
      ownerId: owner.id, callerTerminalId: 't_claude',
      callerHandle: '@james', messageId: 'msg_first'
    });
    expect(caughtMessage(() => gateAndConsumeForWrite({
      ownerId: owner.id, callerTerminalId: 't_claude',
      callerHandle: '@james', messageId: 'msg_second'
    }))).toMatch(/human_impersonation_exhausted/);
  });
});
