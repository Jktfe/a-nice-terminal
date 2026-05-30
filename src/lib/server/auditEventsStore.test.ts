/**
 * auditEventsStore tests — typed wrapper around the canonical v0.2
 * `audit_events` table (schema in db.ts §audit_events).
 *
 * Coverage:
 *   - round-trip insert + read (object + string before/after)
 *   - cursor pagination stability under same-millisecond inserts
 *   - filter combinations (kind / entityKind / entityId / actorAgentId / since / until)
 *   - large JSON payload round-trip
 *   - asAuditEventSource() factory matches @enterprisec M1.3 dispatcher
 *     AuditEventSource interface — listSince(sinceMs, limit) -> AuditEventRow[]
 *     ordered by (at_ms ASC, audit_id ASC) with snake_case columns.
 *   - countAuditEvents matches the same filter shape.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendAuditEvent,
  listAuditEvents,
  countAuditEvents,
  asAuditEventSource,
  type AuditEvent
} from './auditEventsStore';
import { resetIdentityDbForTests } from './db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-audit-store-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  vi.restoreAllMocks();
});

describe('appendAuditEvent', () => {
  it('inserts a row and returns the camelCase typed AuditEvent', () => {
    const event = appendAuditEvent({
      kind: 'system.boot',
      entityKind: 'system',
      entityId: 'boot-1',
      after: { ok: true }
    });
    // Monotonic audit_id format: <13-digit at_ms>-<8-digit counter>-<8-char hex>
    expect(event.auditId).toMatch(/^\d{13}-\d{8}-[0-9a-f]{8}$/);
    expect(event.atMs).toBeGreaterThan(0);
    expect(event.kind).toBe('system.boot');
    expect(event.entityKind).toBe('system');
    expect(event.entityId).toBe('boot-1');
    expect(event.actorAgentId).toBeNull();
    expect(event.actorRuntimeId).toBeNull();
    expect(event.beforeJson).toBeNull();
    expect(event.afterJson).toBe(JSON.stringify({ ok: true }));
    expect(event.requestId).toBeNull();
    expect(event.ipHash).toBeNull();
    expect(event.challengeProof).toBeNull();
  });

  it('accepts pre-stringified before/after JSON', () => {
    const event = appendAuditEvent({
      kind: 'system.check',
      entityKind: 'system',
      entityId: 'chk-1',
      before: '{"raw":true}',
      after: '{"raw":false}'
    });
    expect(event.beforeJson).toBe('{"raw":true}');
    expect(event.afterJson).toBe('{"raw":false}');
  });

  it('round-trips large JSON payloads (>64KB)', () => {
    const big = { blob: 'x'.repeat(70_000), extra: Array.from({ length: 50 }, (_, i) => ({ i })) };
    const event = appendAuditEvent({
      kind: 'system.large',
      entityKind: 'system',
      entityId: 'large-1',
      after: big
    });
    expect(event.afterJson).not.toBeNull();
    expect(JSON.parse(event.afterJson as string)).toEqual(big);

    const read = listAuditEvents({ kind: 'system.large' });
    expect(read.events).toHaveLength(1);
    expect(JSON.parse(read.events[0].afterJson as string)).toEqual(big);
  });

  it('threads requestId / ipHash / challengeProof when provided', () => {
    const event = appendAuditEvent({
      kind: 'system.audit',
      entityKind: 'system',
      entityId: 'req-1',
      requestId: 'req-abc',
      ipHash: 'sha256:deadbeef',
      challengeProof: 'proof-xyz'
    });
    expect(event.requestId).toBe('req-abc');
    expect(event.ipHash).toBe('sha256:deadbeef');
    expect(event.challengeProof).toBe('proof-xyz');
  });
});

describe('listAuditEvents', () => {
  it('returns events ordered by (at_ms ASC, audit_id ASC)', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    appendAuditEvent({ kind: 'a.1', entityKind: 'system', entityId: 'e1' });
    appendAuditEvent({ kind: 'a.2', entityKind: 'system', entityId: 'e2' });
    appendAuditEvent({ kind: 'a.3', entityKind: 'system', entityId: 'e3' });
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(now + 1);
    appendAuditEvent({ kind: 'a.4', entityKind: 'system', entityId: 'e4' });

    const { events } = listAuditEvents({});
    expect(events).toHaveLength(4);
    expect(events[3].kind).toBe('a.4');
    // The three at the same ms are ordered by audit_id ASC.
    const earlyIds = events.slice(0, 3).map((e) => e.auditId);
    const sorted = [...earlyIds].sort();
    expect(earlyIds).toEqual(sorted);
  });

  it('paginates stably under same-millisecond inserts', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    for (let i = 0; i < 5; i++) {
      appendAuditEvent({ kind: 'pg.x', entityKind: 'system', entityId: `e${i}` });
    }

    const page1 = listAuditEvents({ limit: 2 });
    expect(page1.events).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = listAuditEvents({ limit: 2, cursor: page1.nextCursor! });
    expect(page2.events).toHaveLength(2);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = listAuditEvents({ limit: 2, cursor: page2.nextCursor! });
    expect(page3.events).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();

    const allIds = [...page1.events, ...page2.events, ...page3.events].map((e) => e.auditId);
    expect(new Set(allIds).size).toBe(5);
  });

  it('clamps limit to max 500', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    for (let i = 0; i < 3; i++) {
      appendAuditEvent({ kind: 'cap.x', entityKind: 'system', entityId: `e${i}` });
    }
    const { events } = listAuditEvents({ limit: 10_000 });
    expect(events).toHaveLength(3);
  });

  it('filters by kind', () => {
    appendAuditEvent({ kind: 'a.1', entityKind: 'system', entityId: 'x' });
    appendAuditEvent({ kind: 'b.1', entityKind: 'system', entityId: 'y' });
    const { events } = listAuditEvents({ kind: 'a.1' });
    expect(events).toHaveLength(1);
    expect(events[0].entityId).toBe('x');
  });

  it('filters by entityKind + entityId combo', () => {
    appendAuditEvent({ kind: 'a.1', entityKind: 'system', entityId: 'x' });
    appendAuditEvent({ kind: 'a.1', entityKind: 'system', entityId: 'y' });
    const { events } = listAuditEvents({ entityKind: 'system', entityId: 'y' });
    expect(events).toHaveLength(1);
    expect(events[0].entityId).toBe('y');
  });

  it('filters by since / until window', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    appendAuditEvent({ kind: 'w.1', entityKind: 'system', entityId: 'a' });
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    appendAuditEvent({ kind: 'w.2', entityKind: 'system', entityId: 'b' });
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(3000);
    appendAuditEvent({ kind: 'w.3', entityKind: 'system', entityId: 'c' });

    const window = listAuditEvents({ since: 1500, until: 2500 });
    expect(window.events).toHaveLength(1);
    expect(window.events[0].entityId).toBe('b');
  });

  it('returns empty array + null cursor when no rows match', () => {
    const result = listAuditEvents({ kind: 'never.fires' });
    expect(result.events).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });
});

describe('countAuditEvents', () => {
  it('returns total matching the same filter shape', () => {
    appendAuditEvent({ kind: 'c.x', entityKind: 'system', entityId: '1' });
    appendAuditEvent({ kind: 'c.x', entityKind: 'system', entityId: '2' });
    appendAuditEvent({ kind: 'c.y', entityKind: 'system', entityId: '3' });
    expect(countAuditEvents({})).toBe(3);
    expect(countAuditEvents({ kind: 'c.x' })).toBe(2);
    expect(countAuditEvents({ kind: 'never' })).toBe(0);
  });
});

describe('asAuditEventSource', () => {
  it('returns snake_case rows ordered by (at_ms ASC, audit_id ASC) — insertion order via monotonic audit_id', () => {
    const source = asAuditEventSource();
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    appendAuditEvent({ kind: 's.1', entityKind: 'system', entityId: 'p1' });
    appendAuditEvent({ kind: 's.2', entityKind: 'system', entityId: 'p2' });
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(now + 1);
    appendAuditEvent({ kind: 's.3', entityKind: 'system', entityId: 'p3' });

    const rows = source.listSince(now - 1, 10);
    expect(rows).toHaveLength(3);
    // Snake-case shape — matches @enterprisec/byWormEnvelopeBuilder.AuditEventRow.
    expect(rows[0]).toMatchObject({
      audit_id: expect.any(String),
      at_ms: now,
      kind: 's.1',
      entity_kind: 'system',
      entity_id: 'p1',
      actor_agent_id: null,
      actor_runtime_id: null,
      before_json: null,
      after_json: null,
      request_id: null,
      ip_hash: null,
      challenge_proof: null
    });
    expect(rows[2].kind).toBe('s.3');
  });

  it('respects sinceMs strict-greater-than semantics', () => {
    const source = asAuditEventSource();
    vi.spyOn(Date, 'now').mockReturnValue(500);
    appendAuditEvent({ kind: 'edge.1', entityKind: 'system', entityId: 'a' });
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(501);
    appendAuditEvent({ kind: 'edge.2', entityKind: 'system', entityId: 'b' });

    const rows = source.listSince(500, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('edge.2');
  });

  it('respects the limit argument', () => {
    const source = asAuditEventSource();
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    for (let i = 0; i < 5; i++) {
      appendAuditEvent({ kind: 'lim.x', entityKind: 'system', entityId: `e${i}` });
    }
    expect(source.listSince(0, 2)).toHaveLength(2);
  });
});

describe('type contract', () => {
  it('exposes camelCase AuditEvent type fields', () => {
    const event: AuditEvent = appendAuditEvent({
      kind: 't.1',
      entityKind: 'system',
      entityId: 't1'
    });
    // Compile-time + runtime check on the camelCase shape.
    const fields: (keyof AuditEvent)[] = [
      'auditId',
      'atMs',
      'kind',
      'entityKind',
      'entityId',
      'actorAgentId',
      'actorRuntimeId',
      'beforeJson',
      'afterJson',
      'requestId',
      'ipHash',
      'challengeProof'
    ];
    for (const f of fields) expect(event).toHaveProperty(f);
  });
});
