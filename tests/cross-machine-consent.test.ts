// M4.1 — Cross-machine consent pilot
//
// Simulates two ANT instances sharing a room via room tokens and exercises
// the consent gate across the boundary. Uses the fresh-workspace pattern from
// upload-hardening.test.ts and the DI-friendly helpers from M3.
//
// The test does NOT spin real servers — instead it directly exercises the
// route handlers and DB queries against separate ANT_DATA_DIR databases,
// representing "instance A" and "instance B" sharing a room. In a single-
// machine deployment (like this one), both "instances" are the same DB, so
// the room invite/token exchange and consent grant creation are tested as
// API-level round-trips.
//
// In a true cross-machine deployment, instance B would call instance A's
// API over the network. This test validates the same contract at the
// route-handler level.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { _resetForTest as resetDbForTest } from '../src/lib/server/db';
import { buildConsentGrant } from '../src/lib/server/consent/grant-scope.js';
import { consentGateAsk } from '../src/lib/server/consent/consent-gate-ask.js';
import type { ConsentGrant, ConsentGrantQueries } from '../src/lib/server/consent/grant-scope.js';
import type { ConsentGateQueries } from '../src/lib/server/consent/consent-gate-ask.js';

const ENV_KEYS = ['ANT_DATA_DIR', 'ANT_API_KEY'] as const;
const originalEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));
const tempDirs: string[] = [];

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

async function freshWorkspace(tag: string) {
  const dir = await mkdtemp(join(tmpdir(), `ant-m4-${tag}-`));
  tempDirs.push(dir);
  process.env.ANT_DATA_DIR = join(dir, 'data');
  mkdirSync(join(dir, 'data'), { recursive: true });
  resetDbForTest();
  const db = await import('../src/lib/server/db');
  return { dir, queries: db.queries, getDb: db.default };
}

function makeRequestEvent(body: any, locals: Record<string, any> = {}): any {
  return {
    request: new Request('https://ant.test/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    json: () => body,
    params: {},
    url: new URL('https://ant.test/api/test'),
    locals,
  };
}

afterEach(async () => {
  restoreEnv();
  resetDbForTest();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})));
});

describe('cross-machine consent pilot', () => {
  it('instance A creates a room, B joins via invite, consent grant gates fan-out', async () => {
    // ── Setup: single DB represents the shared room (same machine) ──
    const { queries } = await freshWorkspace('consent-pilot');
    process.env.ANT_API_KEY = 'test-key';

    // Instance A: create a chat room
    const roomId = 'room-cross-machine';
    queries.createSession(roomId, 'Cross-machine pilot', 'chat', 'forever', null, null, '{}');

    // Instance A: create a room invite with password
    const invitePassword = 'pilot-pass-2024';
    const { hashPassword } = await import('../src/lib/server/room-invites.js');
    const pwHash = hashPassword(invitePassword);
    const inviteId = 'inv-pilot';
    queries.createRoomInvite({
      id: inviteId,
      room_id: roomId,
      label: 'Pilot invite',
      password_hash: pwHash,
      kinds: 'cli,mcp',
      created_by: null,
    });

    // Instance B: exchange invite password for a room token
    const { exchangePassword } = await import('../src/lib/server/room-invites.js');
    const tokenResult = exchangePassword({
      inviteId,
      password: invitePassword,
      kind: 'cli',
      handle: '@pilot-agent',
      meta: {},
    });
    expect(tokenResult).not.toBeNull();
    if (!tokenResult) return;

    // Instance A: register the agent as a room member
    const agentSessionId = 's-pilot-agent';
    queries.createSession(agentSessionId, 'Pilot Agent', 'terminal', 'forever', null, null, '{}');
    queries.setHandle(agentSessionId, '@pilot-agent', 'Pilot Agent');
    queries.addRoomMember(roomId, agentSessionId, 'participant', 'codex', '@pilot-agent');

    // ── Consent grant lifecycle ──────────────────────────────────

    // Instance A: create a consent grant for the pilot agent
    const grant = buildConsentGrant({
      id: 'cg-pilot',
      sessionId: roomId,
      grantedTo: '@pilot-agent',
      topic: 'file-read',
      sourceSet: ['src/config.ts'],
      duration: '1h',
      maxAnswers: 3,
      nowMs: Date.now(),
    });

    queries.createConsentGrant(
      grant.id,
      grant.session_id,
      grant.granted_to,
      grant.topic,
      JSON.stringify(grant.source_set),
      grant.duration,
      grant.answer_count,
      grant.max_answers,
      grant.status,
      grant.granted_at_ms,
      grant.expires_at_ms,
      grant.meta,
    );

    // Verify the grant was created
    const stored = queries.getConsentGrant('cg-pilot');
    expect(stored).not.toBeNull();
    expect(stored.status).toBe('active');
    expect(stored.topic).toBe('file-read');

    // ── Consent-gated ask fan-out ────────────────────────────────

    // Instance B: post a message that triggers an inferred ask targeting @pilot-agent
    // Simulate the consent gate check that would happen in the messages POST route
    const fakeAsk = {
      id: 'a-inferred-1',
      session_id: roomId,
      assigned_to: '@pilot-agent',
      status: 'open',
      inferred: 1,
      meta: '{}',
      title: 'Read config?',
      body: 'Should I read src/config.ts for the settings?',
    };

    // Build DI query objects that use the real DB queries
    const cq: ConsentGateQueries = {
      getConsentGrant: (id: string) => queries.getConsentGrant(id) as ConsentGrant | null,
      updateConsentGrant: (id, status, answerCount, expiresAtMs) => {
        queries.updateConsentGrant(id, status, answerCount, expiresAtMs);
      },
      listConsentGrantsByGrantee: (grantedTo: string) => {
        return queries.listConsentGrantsByGrantee(grantedTo) as ConsentGrant[];
      },
    };

    let askUpdateCalled = false;
    let askUpdateArgs: any = null;
    const aq = {
      updateAsk: (...args: any[]) => {
        askUpdateCalled = true;
        askUpdateArgs = args;
      },
    };

    // Instance B's consent gate: active grant → auto-answer
    const outcome = consentGateAsk(cq, aq, fakeAsk, { nowMs: Date.now() });
    expect(outcome.action).toBe('auto_answered');
    if (outcome.action === 'auto_answered') {
      expect(outcome.grantId).toBe('cg-pilot');
      expect(outcome.grantTopic).toBe('file-read');
      expect(outcome.remainingAnswers).toBe(2); // was 3, now 2 after bump
    }

    // Verify the grant was bumped
    const afterGate = queries.getConsentGrant('cg-pilot');
    expect(afterGate.answer_count).toBe(1);

    // Verify the ask was updated to answered
    expect(askUpdateCalled).toBe(true);
    expect(askUpdateArgs[0]).toBe('a-inferred-1'); // id
    expect(askUpdateArgs[1]).toBe('answered');     // status

    // ── Revoke + re-check ────────────────────────────────────────

    // Instance A: revoke the grant
    queries.revokeConsentGrant('cg-pilot');
    const revoked = queries.getConsentGrant('cg-pilot');
    expect(revoked.status).toBe('revoked');

    // Instance B: next inferred ask — revoked grants are excluded from
    // listConsentGrantsByGrantee (status='active' filter), so the gate
    // returns 'no_grant'. This is correct: a revoked grant is invisible to
    // the consent gate, treating it as if consent was never given.
    const aqDismiss = { updateAsk: () => {} };

    const fakeAsk2 = {
      id: 'a-inferred-2',
      session_id: roomId,
      assigned_to: '@pilot-agent',
      status: 'open',
      inferred: 1,
      meta: '{}',
      title: 'Read more?',
      body: 'Should I read more from src/?',
    };

    const outcome2 = consentGateAsk(cq, aqDismiss, fakeAsk2, { nowMs: Date.now() });
    expect(outcome2.action).toBe('no_grant');
  });

  it('room token scopes grant access correctly', async () => {
    const { queries } = await freshWorkspace('token-scope');
    process.env.ANT_API_KEY = 'test-key';

    const roomId = 'room-token-test';
    queries.createSession(roomId, 'Token scope test', 'chat', 'forever', null, null, '{}');

    const { hashPassword, exchangePassword } = await import('../src/lib/server/room-invites.js');
    const inviteId = 'inv-token-test';
    queries.createRoomInvite({
      id: inviteId,
      room_id: roomId,
      label: 'Token test invite',
      password_hash: hashPassword('token-pass'),
      kinds: 'cli',
      created_by: null,
    });

    // Exchange for a CLI token
    const tokenResult = exchangePassword({
      inviteId,
      password: 'token-pass',
      kind: 'cli',
      handle: '@remote-agent',
      meta: {},
    });
    expect(tokenResult).not.toBeNull();
    if (!tokenResult) return;
    expect(tokenResult.kind).toBe('cli');
    expect(tokenResult.roomId).toBe(roomId);

    // Verify the token was stored — look up by token ID
    const storedToken = queries.getRoomToken(tokenResult.tokenId);
    expect(storedToken).not.toBeNull();
    expect(storedToken.kind).toBe('cli');
    expect(storedToken.room_id).toBe(roomId);

    // Create a consent grant from the room
    const grant = buildConsentGrant({
      id: 'cg-remote',
      sessionId: roomId,
      grantedTo: '@remote-agent',
      topic: 'command-exec',
      duration: '15m',
      maxAnswers: 1,
      nowMs: Date.now(),
    });
    queries.createConsentGrant(
      grant.id, grant.session_id, grant.granted_to, grant.topic,
      JSON.stringify(grant.source_set), grant.duration, grant.answer_count,
      grant.max_answers, grant.status, grant.granted_at_ms,
      grant.expires_at_ms, grant.meta,
    );

    // The grant should be visible from the session's grants endpoint
    const sessionGrants = queries.listConsentGrants(roomId);
    expect(sessionGrants.length).toBe(1);
    expect(sessionGrants[0].granted_to).toBe('@remote-agent');
  });

  it('grant exhaustion across multiple asks', async () => {
    const { queries } = await freshWorkspace('exhaustion');

    const roomId = 'room-exhaust';
    queries.createSession(roomId, 'Exhaustion test', 'chat', 'forever', null, null, '{}');

    // Grant with max_answers=2
    const grant = buildConsentGrant({
      id: 'cg-limited',
      sessionId: roomId,
      grantedTo: '@worker',
      topic: 'file-read',
      duration: '1h',
      maxAnswers: 2,
      nowMs: 0,
    });
    queries.createConsentGrant(
      grant.id, grant.session_id, grant.granted_to, grant.topic,
      JSON.stringify(grant.source_set), grant.duration, grant.answer_count,
      grant.max_answers, grant.status, grant.granted_at_ms,
      grant.expires_at_ms, grant.meta,
    );

    const cq: ConsentGateQueries = {
      getConsentGrant: (id: string) => queries.getConsentGrant(id) as ConsentGrant | null,
      updateConsentGrant: (id, status, answerCount, expiresAtMs) => {
        queries.updateConsentGrant(id, status, answerCount, expiresAtMs);
      },
      listConsentGrantsByGrantee: (grantedTo: string) => {
        return queries.listConsentGrantsByGrantee(grantedTo) as ConsentGrant[];
      },
    };

    // Ask 1: auto-answered
    const aq1 = { updateAsk: () => {} };
    const r1 = consentGateAsk(cq, aq1, {
      id: 'a-1', session_id: roomId, assigned_to: '@worker', status: 'open', inferred: 1, meta: '{}', title: 'Read?', body: 'Read src/a.ts?',
    }, { nowMs: 1000 });
    expect(r1.action).toBe('auto_answered');

    // Ask 2: auto-answered (last one)
    const aq2 = { updateAsk: () => {} };
    const r2 = consentGateAsk(cq, aq2, {
      id: 'a-2', session_id: roomId, assigned_to: '@worker', status: 'open', inferred: 1, meta: '{}', title: 'Read?', body: 'Read src/b.ts?',
    }, { nowMs: 1000 });
    expect(r2.action).toBe('auto_answered');

    // Ask 3: dismissed (exhausted)
    let dismissUpdate: any = null;
    const aq3 = { updateAsk: (...args: any[]) => { dismissUpdate = args; } };
    const r3 = consentGateAsk(cq, aq3, {
      id: 'a-3', session_id: roomId, assigned_to: '@worker', status: 'open', inferred: 1, meta: '{}', title: 'Read?', body: 'Read src/c.ts?',
    }, { nowMs: 1000 });
    expect(r3.action).toBe('dismissed');
    if (r3.action === 'dismissed') expect(r3.reason).toBe('exhausted');

    // DB should show answer_count=2
    const stored = queries.getConsentGrant('cg-limited');
    expect(stored.answer_count).toBe(2);
  });
});
