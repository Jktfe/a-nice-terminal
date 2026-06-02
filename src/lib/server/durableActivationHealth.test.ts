import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summariseDurableActivation } from './durableActivationHealth';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { createSession } from './antSessionStore';
import { createRoomHandleLease } from './roomHandleLeaseStore';

// durableActivationHealth — READ-ONLY "deployed-but-dormant" self-detector for
// the Simplify & Harden durable-identity model (ant_sessions /
// room_handle_leases). Mirrors the #139 room-health read-model: SELECT/COUNT
// only, writes to NO identity table. It catches the trap where the durable
// model is DEPLOYED but its tables are EMPTY because the fleet is still on the
// old pidChain/room-token fallback path.
//
// Verdict rules (liveTerminals counted the #139 way:
// terminal_records.superseded_at_ms IS NULL JOIN terminals.status='live'):
//   liveTerminals === 0                                  -> 'idle'    (no fleet, not a false alarm)
//   liveTerminals > 0 AND antSessions === 0              -> 'dormant' (model deployed, unpopulated)
//   0 < antSessions < liveTerminals                      -> 'partial' (some clients on durable path)
//   antSessions >= liveTerminals (and > 0)               -> 'active'  (fleet on durable path)

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-durable-activation-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

/** Insert a `terminals` row with explicit id (joined on session_id = id). */
function insertTerminal(args: {
  id: string;
  name?: string;
  status?: 'live' | 'archived' | 'deleted';
}): void {
  const db = getIdentityDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO terminals
       (id, pid, pid_start, name, source, meta, created_at, updated_at, status)
       VALUES (?, 1234, 'pstart', ?, 'test', '{}', ?, ?, ?)`
  ).run(args.id, args.name ?? `term-${args.id}`, now, now, args.status ?? 'live');
}

/** Insert a terminal_records row matching the live-terminal definition. */
function insertTerminalRecord(args: {
  sessionId: string;
  handle?: string | null;
  supersededAtMs?: number | null;
}): void {
  const db = getIdentityDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO terminal_records
       (session_id, name, auto_forward_chat, created_at_ms, updated_at_ms,
        handle, linked_chat_room_id, superseded_at_ms)
       VALUES (?, ?, 1, ?, ?, ?, NULL, ?)`
  ).run(
    args.sessionId,
    `record-${args.sessionId}`,
    now,
    now,
    args.handle ?? null,
    args.supersededAtMs ?? null
  );
}

function addMembershipRow(args: { roomId: string; handle: string; terminalId: string }): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at)
         VALUES (?, ?, ?, ?, ?)`
    )
    .run(`mem-${args.terminalId}-${args.roomId}`, args.roomId, args.handle, args.terminalId, Math.floor(Date.now() / 1000));
}

/** Make a live terminal (terminals + terminal_records). */
function makeLiveTerminal(id: string): void {
  insertTerminal({ id });
  insertTerminalRecord({ sessionId: id, handle: `@${id}` });
}

describe('summariseDurableActivation', () => {
  it("reports 'idle' when there are no live terminals (not a false alarm)", () => {
    const out = summariseDurableActivation();
    expect(out.status).toBe('idle');
    expect(out.counts.liveTerminals).toBe(0);
    expect(out.counts.antSessions).toBe(0);
    expect(out.counts.activeLeases).toBe(0);
    expect(typeof out.reason).toBe('string');
  });

  it("reports 'dormant' when live terminals exist but ant_sessions is empty", () => {
    makeLiveTerminal('s1');
    makeLiveTerminal('s2');

    const out = summariseDurableActivation();
    expect(out.status).toBe('dormant');
    expect(out.counts.liveTerminals).toBe(2);
    expect(out.counts.antSessions).toBe(0);
    expect(out.reason).toMatch(/dormant|fallback|unpopulated/i);
  });

  it("reports 'partial' when some — but not all — live terminals have durable sessions", () => {
    makeLiveTerminal('s1');
    makeLiveTerminal('s2');
    makeLiveTerminal('s3');
    createSession({ kind: 'local-cli', label: 's1' });

    const out = summariseDurableActivation();
    expect(out.status).toBe('partial');
    expect(out.counts.liveTerminals).toBe(3);
    expect(out.counts.antSessions).toBe(1);
  });

  it("reports 'active' when durable sessions cover the live fleet", () => {
    makeLiveTerminal('s1');
    makeLiveTerminal('s2');
    createSession({ kind: 'local-cli', label: 's1' });
    createSession({ kind: 'local-cli', label: 's2' });

    const out = summariseDurableActivation();
    expect(out.status).toBe('active');
    expect(out.counts.liveTerminals).toBe(2);
    expect(out.counts.antSessions).toBe(2);
  });

  it("reports 'active' when durable sessions EXCEED the live fleet (>=)", () => {
    makeLiveTerminal('s1');
    createSession({ kind: 'local-cli', label: 's1' });
    createSession({ kind: 'local-cli', label: 'extra' });

    const out = summariseDurableActivation();
    expect(out.status).toBe('active');
    expect(out.counts.antSessions).toBe(2);
    expect(out.counts.liveTerminals).toBe(1);
  });

  it('counts active room-handle leases (active_until_ms IS NULL)', () => {
    makeLiveTerminal('s1');
    const session = createSession({ kind: 'local-cli', label: 's1' });
    createRoomHandleLease({ roomId: 'room-1', sessionId: session.id, handle: '@s1' });

    const out = summariseDurableActivation();
    expect(out.counts.activeLeases).toBe(1);
  });

  it('excludes superseded terminal_records and non-live terminals from liveTerminals', () => {
    // live
    makeLiveTerminal('live-1');
    // superseded record -> excluded
    insertTerminal({ id: 'super-1' });
    insertTerminalRecord({ sessionId: 'super-1', handle: '@super', supersededAtMs: Date.now() });
    // archived terminal -> excluded
    insertTerminal({ id: 'arch-1', status: 'archived' });
    insertTerminalRecord({ sessionId: 'arch-1', handle: '@arch' });

    const out = summariseDurableActivation();
    expect(out.counts.liveTerminals).toBe(1);
  });

  it('reports oldMemberships count (non-revoked room_memberships)', () => {
    makeLiveTerminal('s1');
    addMembershipRow({ roomId: 'room-1', handle: '@s1', terminalId: 's1' });

    const out = summariseDurableActivation();
    expect(out.counts.oldMemberships).toBeGreaterThanOrEqual(1);
  });

  it('does not throw when ant_sessions table does not exist yet (treats as 0)', () => {
    // Fresh db where no antSessionStore call has run -> ant_sessions absent.
    makeLiveTerminal('s1');
    const out = summariseDurableActivation();
    expect(out.counts.antSessions).toBe(0);
    expect(out.status).toBe('dormant');
  });
});
