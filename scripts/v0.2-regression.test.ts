/**
 * ANT v0.2 regression corpus — incident-linked structural-impossibility tests.
 *
 * What this is
 * ------------
 * A frozen, incident-linked test corpus that gates the v0.2 schema cut-over.
 * Every case here captures a real failure shape observed on 2026-05-29 (or a
 * ratified enterprise scenario from JWPK). Each test STAGES the historical
 * incident, ATTEMPTS the operation that caused tonight's silence/breakage,
 * and ASSERTS the engine rejects it (FK violation, CHECK constraint failure,
 * UNIQUE collision, transaction rollback) — NOT that a recovery codepath
 * caught it.
 *
 * Framing per @cv4 msg_1plzwymklf: "test the impossibility, not just the
 * recovery."
 *
 * Status board: docs/v0.2-regression-corpus.md
 * Concept doc:  docs/concepts/ant-v02-identity-and-recovery.md
 * Helpers:      scripts/v0.2-regression-helpers.ts
 * Skeleton PR:  #95 (chore/v02-regression-corpus-skeleton, 9 it.todo stubs)
 *
 * Maintainers: @cv4 + @speedyc
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from '../src/lib/server/db';
import {
  countActiveTrustKeys,
  lookupAllRuntimes,
  lookupLiveRuntime,
  normalisePidStartIso,
  revokeTrustKey,
  seedAgent,
  seedMembership,
  seedRoom,
  seedRuntime,
  seedTrustKey
} from './v0.2-regression-helpers';

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;
const previousMemoryVaultPath = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-v02-regression-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousDbPath;
  if (previousMemoryVaultPath === undefined) delete process.env.ANT_MEMORY_VAULT_PATH;
  else process.env.ANT_MEMORY_VAULT_PATH = previousMemoryVaultPath;
});

describe('v0.2 regression corpus', () => {
  // ===========================================================================
  // Case #1 — Locale-format pid_start mismatch
  //
  // Incident:    2026-05-29 AM (silence forensic affecting all 19 agents) +
  //              2026-05-29 PM @cv4 fresh-start trip. Fresh register wrote
  //              month-day locale ("Fri May 29 ...") while local `ps lstart`
  //              produced day-month ("Fri 29 May ..."). lookupTerminalByPidChain
  //              did exact-string equality between the two; locale drift →
  //              null result → 403 "Server-resolved identity required".
  //
  // v0.2 impossibility:
  //   The column is named `pid_start_iso` and the write/read paths normalise
  //   to ISO 8601 UTC before binding. Locale strings cannot survive the
  //   normaliser — `normalisePidStartIso` throws on anything that doesn't
  //   start with `YYYY-MM-DDT`. Both writer and reader bind the same
  //   canonical form, so a string-equality compare cannot drift.
  //
  // Schema-level note: there is no CHECK constraint on `pid_start_iso`
  //   (deliberate — the column is TEXT NOT NULL only, since SQLite cannot
  //   pattern-match ISO via cheap CHECK). The structural impossibility lives
  //   in (a) the column naming (no `pid_start` legacy column survives
  //   migration, so locale strings have no home) and (b) the write-side
  //   normaliser. Both are asserted below.
  // ===========================================================================
  it('Case #1: locale-format pid_start cannot reach the SQL bind or the schema', () => {
    const db = getIdentityDb();

    // (a) Schema-level: no legacy `pid_start` column exists on v02_runtimes.
    //     Locale strings have no home — only `pid_start_iso` is reachable.
    const cols = (db
      .prepare(`PRAGMA table_info(v02_runtimes)`)
      .all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('pid_start_iso');
    expect(cols).not.toContain('pid_start');

    // (b) Write-path normaliser rejects locale strings.
    const localeStrings = [
      'Fri May 29 20:00:00 2026', // en_US, what fresh register wrote on 2026-05-29
      'Fri 29 May 20:00:00 2026', // en_GB, what `ps -o lstart=` returned locally
      '2026-05-29 20:00:00',      // SQL-style without `T` — still ambiguous
      'today'                      // junk
    ];
    for (const candidate of localeStrings) {
      expect(() => normalisePidStartIso(candidate)).toThrow(/ISO 8601/);
    }

    // (c) ISO strings pass through and round-trip to canonical UTC form.
    expect(normalisePidStartIso('2026-05-29T20:00:00Z')).toBe('2026-05-29T20:00:00.000Z');
    expect(normalisePidStartIso('2026-05-29T20:00:00.123Z')).toBe('2026-05-29T20:00:00.123Z');

    // (d) End-to-end: register a runtime under the canonical ISO and lookup
    //     by the canonical ISO finds it. No locale drift possible.
    seedAgent(db, 'a-locale', '@cv4');
    const iso = normalisePidStartIso('2026-05-29T20:00:00Z');
    seedRuntime(db, 'rt-locale', 'a-locale', {
      pid: 51382,
      pidStartIso: iso
    });
    const found = lookupLiveRuntime(db, 'a-locale', 51382, iso);
    expect(found).not.toBeNull();
    expect(found?.runtime_id).toBe('rt-locale');
  });

  // ===========================================================================
  // Case #2 — Shadow-terminal shadowing in pidChain walk
  //
  // Incident:    2026-05-29 AM. A stale `claudev4-postrestart` row had
  //              pid=51382 (still live) shadowing the canonical `claudev4`
  //              row during pidChain resolution. pidChain walker stopped at
  //              the first match; the archived shadow with a recycled PID
  //              shadowed the canonical live row, surfacing the wrong
  //              identity to the gate.
  //
  // v0.2 impossibility:
  //   The canonical lookup helper filters `WHERE status='live'` by default.
  //   An archived row CANNOT shadow a live one because it never appears in
  //   the result set. Combined with the partial UNIQUE INDEX
  //   `(agent_id) WHERE status='live'` on v02_runtimes, at most one live
  //   runtime can exist per agent — so the lookup is unambiguous.
  //
  //   Explicit-opt-in: callers that DO need to see archived rows pass
  //   `includeArchived: true`. The option is a code-review-visible signal
  //   that the caller has thought about it.
  // ===========================================================================
  it('Case #2: lookup with archived shadow returns the live row, not the shadow', () => {
    const db = getIdentityDb();
    seedAgent(db, 'a-shadow', '@claudev4');

    // Stage tonight's incident: an archived `claudev4-postrestart` row + a
    // fresh live `claudev4` row with the SAME (pid, pid_start_iso).
    // (In v0.1 both rows were retrievable; in v0.2 the live row wins.)
    const sharedPid = 51382;
    const sharedIso = '2026-05-29T20:00:00.000Z';
    seedRuntime(db, 'rt-shadow-old', 'a-shadow', {
      pid: sharedPid,
      pidStartIso: sharedIso,
      status: 'archived',
      endedAtMs: Date.now() - 60_000
    });
    seedRuntime(db, 'rt-shadow-live', 'a-shadow', {
      pid: sharedPid,
      pidStartIso: sharedIso,
      status: 'live'
    });

    // Canonical lookup: the archived shadow is filtered out — the live row
    // wins. Cannot drift to the wrong identity.
    const found = lookupLiveRuntime(db, 'a-shadow', sharedPid, sharedIso);
    expect(found).not.toBeNull();
    expect(found?.runtime_id).toBe('rt-shadow-live');
    expect(found?.status).toBe('live');

    // Explicit-opt-in callers see both rows — the option must be passed
    // deliberately so it's a code-review-visible signal.
    const all = lookupAllRuntimes(db, 'a-shadow', sharedPid, sharedIso);
    const ids = all.map((r) => r.runtime_id).sort();
    expect(ids).toEqual(['rt-shadow-live', 'rt-shadow-old']);
  });

  // ===========================================================================
  // Case #3 — Dual-bind on fresh register
  //
  // Incident:    2026-05-29 PM @speedyc trip in v4.1 room qexiaw2xpg.
  //              chat_room_members showed @speedyc present; room_memberships
  //              pointed at stale terminal dea7fdf0 while the fresh SpeedyC
  //              terminal t_vjly79fxu9 sat idle. Four-tables-doing-one-job
  //              produced an inconsistent state per logical entity.
  //
  // v0.2 impossibility:
  //   SINGLE memberships table with FK to v02_agents AND v02_rooms. There
  //   is NO chat_room_members-shaped parallel roster table to drift from.
  //   Inserting a membership row whose agent_id doesn't exist in v02_agents
  //   fails with a FOREIGN KEY constraint. Same for room_id → v02_rooms.
  //
  //   Critically: v02_memberships has NO fanout_target_runtime_id column.
  //   Fanout target derives from `v02_agents.current_runtime_id` at SEND
  //   time, so there is no cached field that can desynchronise. (Verified
  //   in v02-schema.test.ts § "memberships has NO fanout_target_runtime_id".)
  // ===========================================================================
  it('Case #3: membership rejects unknown agent_id or room_id at FK level', () => {
    const db = getIdentityDb();

    // (a) FK rejects membership with non-existent agent_id.
    seedRoom(db, 'r-dual', 'V4.1');
    expect(() =>
      db.prepare(
        `INSERT INTO v02_memberships (
           membership_id, agent_id, room_id, role, joined_at_ms
         ) VALUES (?, ?, ?, ?, ?)`
      ).run('m-bad-agent', 'agent-does-not-exist', 'r-dual', 'member', Date.now())
    ).toThrow(/FOREIGN KEY constraint failed/);

    // (b) FK rejects membership with non-existent room_id.
    seedAgent(db, 'a-speedyc', '@speedyc');
    expect(() =>
      db.prepare(
        `INSERT INTO v02_memberships (
           membership_id, agent_id, room_id, role, joined_at_ms
         ) VALUES (?, ?, ?, ?, ?)`
      ).run('m-bad-room', 'a-speedyc', 'room-does-not-exist', 'member', Date.now())
    ).toThrow(/FOREIGN KEY constraint failed/);

    // (c) The structural fix: there is NO parallel chat_room_members-shaped
    //     v0.2 table to fall back to. The v0.2 surface area for "who is in
    //     this room" is exactly v02_memberships.
    const v02RosterTables = (db
      .prepare(
        `SELECT name FROM sqlite_master
           WHERE type='table' AND name LIKE 'v02_%'
             AND (name LIKE '%member%' OR name LIKE '%roster%')`
      )
      .all() as { name: string }[]).map((r) => r.name);
    expect(v02RosterTables).toEqual(['v02_memberships']);

    // (d) v02_memberships has NO cached runtime pointer that could drift.
    //     This is the structural fix for the silent-fanout-drift bug.
    const cols = (db
      .prepare(`PRAGMA table_info(v02_memberships)`)
      .all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain('fanout_target_runtime_id');
    expect(cols).not.toContain('terminal_id');
    expect(cols).not.toContain('runtime_id');
  });

  // ===========================================================================
  // Case #4 — Six-rooms × stub-id breakage
  //
  // Incident:    2026-05-29 AM bulk fanout rebind across 33 stale bindings
  //              affecting 19 agents in 6+ rooms. Concurrent rebinds
  //              collided on the same `room_memberships.id` and reads saw
  //              partial state — some rooms on the new terminal_id, others
  //              on the old, agent appeared mute in 1+ rooms.
  //
  // v0.2 impossibility:
  //   There is no per-membership cached `terminal_id` to rebind. Fanout
  //   resolves at send time via a single read of
  //   `v02_agents.current_runtime_id`. A reclaim is a single UPDATE on ONE
  //   row (the agent's `current_runtime_id` pointer). All 6 memberships
  //   resolve via that same pointer, so a reader sees either pre-swap
  //   (all-A) or post-swap (all-B), never a partial mix.
  //
  // Test shape: stage 6 rooms with memberships for one agent. The
  //   "send-time fanout" query JOINS memberships to agents.current_runtime_id
  //   so all 6 rooms resolve via ONE column read. We perform an atomic swap
  //   of that pointer and observe that BEFORE the swap all reads return
  //   runtime A and AFTER the swap all reads return runtime B — with no
  //   path to a mixed result. SQLite is single-writer; the swap is one
  //   UPDATE on one row, atomic by construction.
  // ===========================================================================
  it('Case #4: 6-room atomic fanout swap is observed as all-old or all-new, never mixed', () => {
    const db = getIdentityDb();
    seedAgent(db, 'a-bulk', '@codex4');

    // 6 rooms + 6 memberships under the one agent.
    const roomIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const roomId = `r-bulk-${i}`;
      seedRoom(db, roomId, `Bulk Room ${i}`);
      seedMembership(db, `m-bulk-${i}`, 'a-bulk', roomId);
      roomIds.push(roomId);
    }

    // Runtime A active first.
    seedRuntime(db, 'rt-bulk-A', 'a-bulk', { host: 'host-A' });
    db.prepare(`UPDATE v02_agents SET current_runtime_id='rt-bulk-A' WHERE agent_id='a-bulk'`).run();

    // Send-time fanout query the cut-over server will use: JOIN memberships
    // to agents to resolve the target runtime per room. Snapshot BEFORE the
    // swap → all 6 rooms point at A.
    const fanoutQuery = db.prepare(
      `SELECT m.room_id, a.current_runtime_id AS rt
         FROM v02_memberships m
         JOIN v02_agents a ON a.agent_id = m.agent_id
         WHERE m.agent_id = ? AND m.left_at_ms IS NULL`
    );
    const beforeSwap = fanoutQuery.all('a-bulk') as Array<{ room_id: string; rt: string }>;
    expect(beforeSwap).toHaveLength(6);
    for (const row of beforeSwap) expect(row.rt).toBe('rt-bulk-A');

    // Atomic swap: archive runtime A, mint runtime B, flip the agent
    // pointer. The pointer flip is ONE UPDATE on ONE row — readers see
    // either pre-flip or post-flip, never partial. We run the flip in an
    // explicit transaction so any reader that started before COMMIT sees
    // the pre-flip snapshot.
    const swap = db.transaction(() => {
      db.prepare(
        `UPDATE v02_runtimes SET status='archived', ended_at_ms=? WHERE runtime_id='rt-bulk-A'`
      ).run(Date.now());
      seedRuntime(db, 'rt-bulk-B', 'a-bulk', { host: 'host-B' });
      db.prepare(
        `UPDATE v02_agents SET current_runtime_id='rt-bulk-B' WHERE agent_id='a-bulk'`
      ).run();
    });
    swap();

    // After-swap snapshot → all 6 rooms point at B. No mix.
    const afterSwap = fanoutQuery.all('a-bulk') as Array<{ room_id: string; rt: string }>;
    expect(afterSwap).toHaveLength(6);
    for (const row of afterSwap) expect(row.rt).toBe('rt-bulk-B');

    // Structural fix proof: there is NO per-membership cached runtime_id
    // that could be partially updated. The fanout target lives on ONE
    // column on ONE row; partial-update is structurally impossible.
    const cols = (db
      .prepare(`PRAGMA table_info(v02_memberships)`)
      .all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain('fanout_target_runtime_id');
    expect(cols).not.toContain('current_runtime_id');
  });

  // ===========================================================================
  // Case #5 — Competing-rebind race (instance #4 of 2026-05-29)
  //
  // Incident:    2026-05-29 PM @speedyc msg_r4xqwhayvq — "@cv4 fixing me
  //              broke @codex4 temporarily". Agent A's rebind to UUID X +
  //              Agent B's later rebind to UUID Y stomped each other; one
  //              writer's UPDATE-old → UPDATE-new race window returned NULL
  //              to a concurrent reader. Fired 4+ times tonight.
  //
  // v0.2 impossibility:
  //   The reclaim primitive uses compare-and-swap (CAS) semantics: the
  //   caller MUST pass the previously-observed runtime_id, and the UPDATE
  //   carries a `WHERE current_runtime_id = ?` guard against it. A stale
  //   caller (i.e. one whose `prev_runtime_id` no longer matches the
  //   current value) gets 0 rows updated — the rebind is rejected loudly,
  //   not silently overwritten.
  //
  // Test shape: stage agent pointing at runtime X. Run two CAS swaps in
  //   sequence — first observes prev=X (succeeds, flips to Y); second
  //   observes prev=X (now stale, returns 0 changed rows). The second
  //   caller learns immediately that its prev was stale and can retry
  //   with the fresh value, instead of silently winning a race.
  // ===========================================================================
  it('Case #5: competing rebinds — stale prev fails the CAS, no silent overwrite', () => {
    const db = getIdentityDb();
    seedAgent(db, 'a-race', '@codex4');
    seedRuntime(db, 'rt-X', 'a-race');
    db.prepare(`UPDATE v02_agents SET current_runtime_id='rt-X' WHERE agent_id='a-race'`).run();

    // Mint candidate runtimes Y and Z that both A and B want to swap to.
    // (Set them stale so they don't violate the live-uniqueness invariant
    // before we activate them.)
    seedRuntime(db, 'rt-Y', 'a-race', { status: 'stale', host: 'host-Y' });
    seedRuntime(db, 'rt-Z', 'a-race', { status: 'stale', host: 'host-Z' });

    // CAS swap helper: only updates when prev_runtime_id matches the
    // currently-stored value. This is the v0.2 reclaim primitive shape.
    function casSwap(prevRuntimeId: string, newRuntimeId: string): number {
      const info = db
        .prepare(
          `UPDATE v02_agents
              SET current_runtime_id = ?
            WHERE agent_id = ? AND current_runtime_id = ?`
        )
        .run(newRuntimeId, 'a-race', prevRuntimeId);
      return info.changes;
    }

    // Agent A observes prev=X, swaps to Y → succeeds.
    const aChanges = casSwap('rt-X', 'rt-Y');
    expect(aChanges).toBe(1);

    // Agent B (concurrent reader who also observed prev=X earlier) attempts
    // to swap from X to Z. By the time it runs, current_runtime_id is Y,
    // not X. CAS guards against the stale prev → 0 rows changed.
    const bChanges = casSwap('rt-X', 'rt-Z');
    expect(bChanges).toBe(0);

    // The state is Y, NOT Z. No silent overwrite.
    const current = (db
      .prepare(`SELECT current_runtime_id FROM v02_agents WHERE agent_id='a-race'`)
      .get() as { current_runtime_id: string }).current_runtime_id;
    expect(current).toBe('rt-Y');

    // B can recover by re-reading the fresh value and retrying the CAS.
    const bRetry = casSwap('rt-Y', 'rt-Z');
    expect(bRetry).toBe(1);
    const final = (db
      .prepare(`SELECT current_runtime_id FROM v02_agents WHERE agent_id='a-race'`)
      .get() as { current_runtime_id: string }).current_runtime_id;
    expect(final).toBe('rt-Z');
  });

  // ===========================================================================
  // Case #6 — Post-restart membership orphan
  //
  // Incident:    Server restart killed terminal rows while membership rows
  //              still pointed at the dead terminal_ids → resolve-by-handle
  //              path went silent because membership.terminal_id no longer
  //              resolved to a live row.
  //
  // v0.2 impossibility:
  //   v02_memberships has NO `terminal_id` / `runtime_id` column at all
  //   (verified in Case #3 + v02-schema.test.ts § "memberships has NO
  //   fanout_target_runtime_id"). It references `v02_agents.agent_id`,
  //   which is the DURABLE identity that survives any runtime restart.
  //   The runtime lifecycle (start → live → stale → archived) happens on
  //   v02_runtimes independently; v02_agents.current_runtime_id may be
  //   nulled during the dead window but the membership row is untouched.
  //
  //   At v02_agents row level, the FK on v02_memberships.agent_id ensures
  //   no membership can point at a non-existent agent. Deleting an agent
  //   is blocked while memberships exist (default RESTRICT).
  // ===========================================================================
  it('Case #6: memberships outlive runtime restart — no orphan-runtime pointer exists', () => {
    const db = getIdentityDb();
    seedAgent(db, 'a-restart', '@speedyc');
    seedRoom(db, 'r-restart', 'Restart Room');
    seedMembership(db, 'm-restart', 'a-restart', 'r-restart');

    // Mint a runtime + link the agent to it.
    seedRuntime(db, 'rt-restart', 'a-restart');
    db.prepare(
      `UPDATE v02_agents SET current_runtime_id='rt-restart' WHERE agent_id='a-restart'`
    ).run();

    // Server restart: archive the runtime + null the agent pointer.
    // Memberships row is COMPLETELY untouched — there is nothing on it
    // pointing at the runtime to go stale.
    db.prepare(
      `UPDATE v02_agents SET current_runtime_id=NULL WHERE agent_id='a-restart'`
    ).run();
    db.prepare(
      `UPDATE v02_runtimes SET status='archived', ended_at_ms=? WHERE runtime_id='rt-restart'`
    ).run(Date.now());

    // Membership row still resolves by the durable agent identity.
    const memb = db
      .prepare(`SELECT agent_id, room_id, left_at_ms FROM v02_memberships WHERE membership_id='m-restart'`)
      .get() as { agent_id: string; room_id: string; left_at_ms: number | null };
    expect(memb.agent_id).toBe('a-restart');
    expect(memb.room_id).toBe('r-restart');
    expect(memb.left_at_ms).toBeNull();

    // FK on v02_memberships.agent_id REFERENCES v02_agents prevents an
    // orphan-pointing state: attempting to point a fresh membership at a
    // non-existent agent fails with FK violation.
    seedRoom(db, 'r-restart-2', 'Restart Room 2');
    expect(() =>
      db.prepare(
        `INSERT INTO v02_memberships (
           membership_id, agent_id, room_id, role, joined_at_ms
         ) VALUES (?, ?, ?, ?, ?)`
      ).run('m-orphan', 'a-does-not-exist', 'r-restart-2', 'member', Date.now())
    ).toThrow(/FOREIGN KEY constraint failed/);

    // And: deleting the agent while memberships exist is blocked by FK
    // (default behaviour — no ON DELETE CASCADE on v02_memberships, which
    // is correct because deleting an agent should be an explicit two-step
    // operation, not a cascade).
    expect(() =>
      db.prepare(`DELETE FROM v02_agents WHERE agent_id='a-restart'`).run()
    ).toThrow(/FOREIGN KEY constraint failed/);

    // Recovery path: minting a fresh runtime and flipping the pointer
    // restores fanout target for ALL memberships at once — no per-row
    // rebind needed.
    seedRuntime(db, 'rt-restart-fresh', 'a-restart', { host: 'host-fresh' });
    db.prepare(
      `UPDATE v02_agents SET current_runtime_id='rt-restart-fresh' WHERE agent_id='a-restart'`
    ).run();
    const post = db
      .prepare(
        `SELECT a.current_runtime_id AS rt
           FROM v02_memberships m
           JOIN v02_agents a ON a.agent_id = m.agent_id
          WHERE m.membership_id='m-restart'`
      )
      .get() as { rt: string };
    expect(post.rt).toBe('rt-restart-fresh');
  });

  // ===========================================================================
  // Case #7 — Manual add-member with stub-string terminal_id
  //
  // Incident:    Today the room add-member surface accepted a literal handle
  //              string as terminal_id (e.g. `terminal_id = 'speedyclaude'`)
  //              because the legacy column was loosely typed. Fired 6 times
  //              tonight in the JWPK-as-attacker case.
  //
  // v0.2 impossibility:
  //   v02_memberships does not have a `terminal_id` column at all (verified
  //   in Case #3). The only writeable identity FK is `agent_id`, which
  //   REFERENCES v02_agents(agent_id). A literal handle string like
  //   `'speedyclaude'` (without the `a-` agent_id prefix that the canonical
  //   identities table assigns) is not a valid agent_id and the FK rejects it.
  //
  //   The v0.2 CLI surface for adding members (not yet shipped — out of
  //   scope this PR per concept doc §Out of Scope) will resolve handle →
  //   agent_id internally. The structural backstop is that even if the CLI
  //   surface were bypassed, the SQL layer rejects the bad insert.
  //
  // Application-layer note: the v0.2 add-member endpoint is part of the
  //   cut-over PR's surface area. When that ships, this case should grow a
  //   second assertion: POST /api/rooms/:roomId/members with a `terminal_id`
  //   field is either ignored (server resolves from handle) or rejected
  //   with 400. Filed against milestone p6-regression-corpus-app-layer for
  //   follow-up.
  // ===========================================================================
  it('Case #7: SQL rejects a literal handle-string as agent_id (FK to v02_agents)', () => {
    const db = getIdentityDb();
    seedRoom(db, 'r-attack', 'Attack Room');
    // Seed the agent with its canonical agent_id; the canonical handle is
    // separate from the agent_id, exactly to prevent confusion between
    // them. JWPK-as-attacker passes the HANDLE where an AGENT_ID is
    // expected — FK rejects.
    seedAgent(db, 'a-speedyc-canonical', '@speedyclaude');

    // Attack #1: insert with literal handle string as agent_id.
    expect(() =>
      db.prepare(
        `INSERT INTO v02_memberships (
           membership_id, agent_id, room_id, role, joined_at_ms
         ) VALUES (?, ?, ?, ?, ?)`
      ).run('m-attack-1', 'speedyclaude', 'r-attack', 'member', Date.now())
    ).toThrow(/FOREIGN KEY constraint failed/);

    // Attack #2: insert with @-prefixed handle string as agent_id.
    expect(() =>
      db.prepare(
        `INSERT INTO v02_memberships (
           membership_id, agent_id, room_id, role, joined_at_ms
         ) VALUES (?, ?, ?, ?, ?)`
      ).run('m-attack-2', '@speedyclaude', 'r-attack', 'member', Date.now())
    ).toThrow(/FOREIGN KEY constraint failed/);

    // Attack #3: insert with a plausible-but-fake agent_id.
    expect(() =>
      db.prepare(
        `INSERT INTO v02_memberships (
           membership_id, agent_id, room_id, role, joined_at_ms
         ) VALUES (?, ?, ?, ?, ?)`
      ).run('m-attack-3', 'a-fake', 'r-attack', 'member', Date.now())
    ).toThrow(/FOREIGN KEY constraint failed/);

    // Valid insert with the canonical agent_id succeeds — proves the FK
    // is checking the right thing, not just rejecting everything.
    seedMembership(db, 'm-canonical', 'a-speedyc-canonical', 'r-attack');
    const count = (db
      .prepare(`SELECT COUNT(*) AS c FROM v02_memberships WHERE room_id='r-attack'`)
      .get() as { c: number }).c;
    expect(count).toBe(1);

    // Structural backstop: v02_memberships has NO `terminal_id` column
    // for an attacker to target.
    const cols = (db
      .prepare(`PRAGMA table_info(v02_memberships)`)
      .all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain('terminal_id');
    expect(cols).not.toContain('handle');
  });

  // ===========================================================================
  // Case #8 — Nifty-leak (skill/tool catalog ghosts)
  //
  // Incident:    JWPK msg_mjh7rgi3wa — "Using nifty. Where did that come
  //              from? That was a memory that I was supposed to have
  //              deleted." Skills loaded from filesystem globs (per-vault,
  //              per-machine, per-config) didn't propagate deletion; cached
  //              copies surfaced as ghost capabilities.
  //
  // v0.2 impossibility:
  //   v02_tool_grants is the source of truth for which (agent / org / room)
  //   can use which tool_slug. The grant row carries `revoked_at_ms`;
  //   active grants are those with `revoked_at_ms IS NULL`. Revoking a
  //   grant writes `revoked_at_ms`; the grant remains in the table (for
  //   audit history) but is invisible to active-grant lookups.
  //
  //   Soft-delete pattern: the standard "active grant" query filters
  //   `WHERE revoked_at_ms IS NULL`. A revoked grant cannot grant access.
  //   At the same time, audit queries can still see the revoked row.
  //
  // Application-layer note: per the v0.2 concept doc §Tool Catalog, a
  //   separate `tools` (catalog) table will land in PR-D (Tue 2026-06-02)
  //   to give us a typed source-of-truth for tool definitions. The
  //   v0.2-schema-tables PR explicitly DOES NOT include this table —
  //   tool_slug on v02_tool_grants is open-ended TEXT. The structural
  //   impossibility shipped TODAY is that revoking a grant immediately
  //   removes it from active lookups; revoking the underlying tool will
  //   be FK-driven once PR-D lands.
  //
  //   Tracked: case 8 will grow a second assertion against the `tools`
  //   table once it exists. Filed against plan milestone p6-regression-
  //   corpus-tools-catalog for follow-up.
  // ===========================================================================
  it('Case #8: soft-revoked grants are excluded from active lookup AND visible to audit', () => {
    const db = getIdentityDb();
    seedAgent(db, 'a-tool-grantor', '@jwpk');
    seedAgent(db, 'a-tool-grantee', '@speedyc');

    // Grant @speedyc the `nifty` tool.
    db.prepare(
      `INSERT INTO v02_tool_grants (
         grant_id, subject_kind, subject_id, tool_slug, permission,
         granted_by_agent_id, granted_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'tg-nifty',
      'agent',
      'a-tool-grantee',
      'nifty',
      'use',
      'a-tool-grantor',
      Date.now()
    );

    // Active-grant lookup finds it (capability is live).
    const activeBeforeRevoke = db
      .prepare(
        `SELECT grant_id FROM v02_tool_grants
          WHERE subject_kind = 'agent' AND subject_id = ?
            AND tool_slug = ? AND revoked_at_ms IS NULL`
      )
      .all('a-tool-grantee', 'nifty') as Array<{ grant_id: string }>;
    expect(activeBeforeRevoke.map((r) => r.grant_id)).toEqual(['tg-nifty']);

    // Soft-revoke (JWPK deletes the skill from the vault → server writes
    // revoked_at_ms on the grant). The row REMAINS in the table.
    db.prepare(
      `UPDATE v02_tool_grants
          SET revoked_at_ms = ?, revoked_by_agent_id = ?
        WHERE grant_id = ?`
    ).run(Date.now(), 'a-tool-grantor', 'tg-nifty');

    // Active-grant lookup excludes it — JWPK's intended "delete" stuck.
    const activeAfterRevoke = db
      .prepare(
        `SELECT grant_id FROM v02_tool_grants
          WHERE subject_kind = 'agent' AND subject_id = ?
            AND tool_slug = ? AND revoked_at_ms IS NULL`
      )
      .all('a-tool-grantee', 'nifty') as Array<{ grant_id: string }>;
    expect(activeAfterRevoke).toEqual([]);

    // Audit lookup still sees it — the revocation is visible to admins.
    // This is the `ant audit orphans` substrate.
    const auditAll = db
      .prepare(
        `SELECT grant_id, revoked_at_ms FROM v02_tool_grants
          WHERE subject_kind = 'agent' AND subject_id = ? AND tool_slug = ?`
      )
      .all('a-tool-grantee', 'nifty') as Array<{ grant_id: string; revoked_at_ms: number | null }>;
    expect(auditAll).toHaveLength(1);
    expect(auditAll[0].revoked_at_ms).not.toBeNull();
  });

  // ===========================================================================
  // Case #9a — Identity has multiple active device keys; revoking one
  //             does not touch the others, does not revoke memberships,
  //             does not break the agent's identity.
  //
  // Incident:    JWPK msg_gtzwsh340p — "James Stevenson was in a car crash
  //              on Wednesday, and his laptop got fucking stuck in the
  //              boot... What happens then?" Single trust_pubkey = lose
  //              private key = lose agent forever.
  //
  // v0.2 impossibility:
  //   v02_agent_trust_keys allows N keys per agent. Revoking one writes
  //   revoked_at_ms on that row; other rows are untouched. The agent's
  //   memberships are stored on v02_memberships (referencing agent_id, not
  //   any key_id) so they're untouched by a key revocation.
  //
  // Test shape: 3 device keys + 1 recovery key. Revoke one device key.
  //   2 device + 1 recovery remain active; memberships unchanged.
  // ===========================================================================
  it('Case #9a: revoke 1 of 3 device keys — 2 device + 1 recovery remain, memberships untouched', () => {
    const db = getIdentityDb();
    seedAgent(db, 'a-stevenson', '@stevenson');

    // 3 device keys + 1 recovery key.
    seedTrustKey(db, 'k-laptop', 'a-stevenson', { keyKind: 'device', deviceLabel: 'Laptop' });
    seedTrustKey(db, 'k-mini', 'a-stevenson', { keyKind: 'device', deviceLabel: 'Mac Mini' });
    seedTrustKey(db, 'k-iphone', 'a-stevenson', { keyKind: 'device', deviceLabel: 'iPhone' });
    seedTrustKey(db, 'k-recovery', 'a-stevenson', { keyKind: 'recovery', deviceLabel: 'Paper' });

    // Memberships across 3 rooms.
    seedRoom(db, 'r-svn-1', 'Standup');
    seedRoom(db, 'r-svn-2', 'Eng');
    seedRoom(db, 'r-svn-3', 'Random');
    seedMembership(db, 'm-svn-1', 'a-stevenson', 'r-svn-1');
    seedMembership(db, 'm-svn-2', 'a-stevenson', 'r-svn-2');
    seedMembership(db, 'm-svn-3', 'a-stevenson', 'r-svn-3');

    // Baseline: 4 active keys.
    expect(countActiveTrustKeys(db, 'a-stevenson')).toBe(4);

    // Laptop is destroyed in the boot. Revoke the laptop key.
    revokeTrustKey(db, 'k-laptop', 'lost-device', 'a-stevenson');

    // 3 keys remain active. 2 device + 1 recovery.
    expect(countActiveTrustKeys(db, 'a-stevenson')).toBe(3);
    const activeByKind = db
      .prepare(
        `SELECT key_kind, COUNT(*) AS c FROM v02_agent_trust_keys
          WHERE agent_id = ? AND revoked_at_ms IS NULL
          GROUP BY key_kind ORDER BY key_kind`
      )
      .all('a-stevenson') as Array<{ key_kind: string; c: number }>;
    expect(activeByKind).toEqual([
      { key_kind: 'device', c: 2 },
      { key_kind: 'recovery', c: 1 }
    ]);

    // Memberships are UNCHANGED — no cascade from key revocation to rooms.
    const memberRooms = db
      .prepare(
        `SELECT room_id FROM v02_memberships
          WHERE agent_id = ? AND left_at_ms IS NULL
          ORDER BY room_id`
      )
      .all('a-stevenson') as Array<{ room_id: string }>;
    expect(memberRooms.map((r) => r.room_id)).toEqual(['r-svn-1', 'r-svn-2', 'r-svn-3']);

    // The agent identity itself is untouched: same agent_id, same handle,
    // status still 'live'. No identity loss from key loss.
    const agent = db
      .prepare(`SELECT primary_handle, status FROM v02_agents WHERE agent_id='a-stevenson'`)
      .get() as { primary_handle: string; status: string };
    expect(agent.primary_handle).toBe('@stevenson');
    expect(agent.status).toBe('live');

    // The revoked key row remains in the table (audit history). It's
    // simply not selectable as 'active'.
    const revokedRow = db
      .prepare(
        `SELECT revoked_at_ms, revoked_reason, revoked_by_agent_id
           FROM v02_agent_trust_keys WHERE key_id='k-laptop'`
      )
      .get() as { revoked_at_ms: number; revoked_reason: string; revoked_by_agent_id: string };
    expect(revokedRow.revoked_at_ms).not.toBeNull();
    expect(revokedRow.revoked_reason).toBe('lost-device');
    expect(revokedRow.revoked_by_agent_id).toBe('a-stevenson');
  });

  // ===========================================================================
  // Case #9b — Recover from paper-key with correct mnemonic mints a new
  //             device key + new attestation + rotates the paper_key_hash.
  //
  // BLOCKED ON SUBSTRATE:
  //   The `paper_key_hash` column lives on the `identities` table that
  //   PR #99 (feat/identity-keys-multi-device, branch
  //   feat/identity-keys-multi-device) introduces. The v0.2 schema
  //   migration in THIS branch (commit 8fe99a9 on feat/v0.2-schema-tables)
  //   ships v02_agent_trust_keys (which has a `key_kind='recovery'` slot)
  //   but does NOT include the PR #99 `identities.paper_key_hash` column
  //   nor an `identity_attestations` table.
  //
  //   The strongest assertion available against v0.2-schema-tables alone
  //   is: minting a new device key via INSERT on v02_agent_trust_keys
  //   works (covered by Case #9a) and the prior recovery key can be
  //   revoked atomically. The paper-key-hash rotation is a Stage B
  //   follow-up once PR #99 merges to the cut-over branch.
  //
  //   Milestone filed: plan ant-substrate-v0.2-2026-05-29 milestone
  //   p6-regression-corpus-paper-key for paper-key recovery primitives.
  //   Once PR #99 lands on the cut-over branch the body lands.
  // ===========================================================================
  it.todo(
    'Case #9b: recover-from-paper-key (correct mnemonic) mints new key + rotates paper_key_hash — BLOCKED on PR #99 tables (milestone p6-regression-corpus-paper-key)'
  );

  // ===========================================================================
  // Case #9c — Recover from paper-key with WRONG mnemonic is rejected,
  //             no key minted, no rows mutated, attempt audited.
  //
  // BLOCKED ON SUBSTRATE:
  //   Same dependency as 9b — `paper_key_hash` lives on PR #99's
  //   identities table. v0.2-schema-tables alone cannot stage the
  //   "stored hash vs supplied mnemonic" comparison because the column
  //   doesn't exist on this branch.
  //
  //   Once PR #99 merges into the cut-over branch the body lands and
  //   asserts: (a) wrong mnemonic → 403, (b) no new v02_agent_trust_keys
  //   row, (c) paper_key_hash unchanged, (d) v02_audit_events row written
  //   with verb='paper_key_recovery_rejected'.
  //
  //   Milestone filed: same as 9b (p6-regression-corpus-paper-key).
  // ===========================================================================
  it.todo(
    'Case #9c: recover-from-paper-key (wrong mnemonic) rejected + audited — BLOCKED on PR #99 tables (milestone p6-regression-corpus-paper-key)'
  );
});
