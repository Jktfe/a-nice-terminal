/**
 * ANT v0.2 regression corpus — skeleton
 *
 * What this is
 * ------------
 * A frozen, incident-linked test corpus that gates the v0.2 schema cut-over.
 * Every case here captures a real failure shape observed on 2026-05-29 (or a
 * ratified enterprise scenario from JWPK). When v0.2 lands, each `todo` here
 * becomes a real assertion that the failure mode is STRUCTURALLY impossible
 * under the new schema — not merely "we fixed it once".
 *
 * Why it exists
 * -------------
 * The frankensteined v0.1 schema (terminals + terminal_records + room_memberships
 * + chat_room_members all claiming to know "what is the current binding for @X")
 * produces correlated failure modes under concurrent writes. v0.2 collapses this
 * into a single durable identity (agents) + ephemeral runtime (runtimes) + one
 * memberships table with fanout target DERIVED at send time. Without a corpus,
 * the cut-over PR can quietly reintroduce today's bugs and we won't notice
 * until the next on-call incident.
 *
 * Contract
 * --------
 * Each case below is a `todo` stub paired with a comment block describing:
 *   1. The incident that produced it (date, source room+msg_id)
 *   2. What was broken under the v0.1 schema
 *   3. The v0.2 invariant that should make the failure structurally impossible
 *
 * The bodies stay `todo` until the v0.2 schema lands — they would otherwise
 * fail (correctly) against the current schema, defeating the gate. Assertions
 * are written incrementally as each migration PR lands; see
 * docs/v0.2-regression-corpus.md for the per-case status board.
 *
 * Maintainers: @cv4 + @speedyc
 * Concept doc: docs/concepts/ant-v02-identity-and-recovery.md
 * Index:       docs/v0.2-regression-corpus.md
 */

import { describe, it } from 'vitest';

describe('v0.2 regression corpus', () => {
  // ---------------------------------------------------------------------------
  // Case #1 — Locale-format pid_start mismatch
  //
  // Incident:    2026-05-29 AM (silence forensic affecting all 19 agents) +
  //              2026-05-29 PM @cv4 fresh-start trip.
  //              Fresh register wrote month-day locale ("Fri May 29 ...") while
  //              local `ps lstart` produced day-month ("Fri 29 May ...").
  // Broken:      lookupTerminalByPidChain does exact-string equality on the
  //              `pid_start` column between DB-stored locale string and
  //              caller-supplied locale string. Locale drift → null result →
  //              403 "Server-resolved identity required".
  // v0.2 fix:    runtimes.pid_start_iso (ISO 8601 UTC) — no locale on the
  //              wire, no locale in the row. PR-A already shipped the
  //              normalisation against the current schema.
  // ---------------------------------------------------------------------------
  it.todo(
    'Case #1: lookupRuntime resolves across locale formats (pid_start_iso)'
  );

  // ---------------------------------------------------------------------------
  // Case #2 — Shadow-terminal shadowing in pidChain walk
  //
  // Incident:    2026-05-29 AM. A stale `claudev4-postrestart` row had
  //              pid=51382 (still live) shadowing the canonical `claudev4`
  //              row during pidChain resolution.
  // Broken:      pidChain walker stops at first match; shadow rows with
  //              higher PIDs in the ancestry block resolution to the
  //              canonical row, surfacing the wrong agent identity.
  // v0.2 fix:    lookupRuntimeByPidChain filters on `runtimes.status='live'`
  //              (Phase A3-style). Shadow rows with status='archived' or
  //              'reclaimed' are skipped. Combined with the partial unique
  //              index `(agent_id) WHERE status='live'`, at most one live
  //              runtime can exist per agent.
  // ---------------------------------------------------------------------------
  it.todo(
    'Case #2: pidChain walk skips non-live runtime rows (status filter)'
  );

  // ---------------------------------------------------------------------------
  // Case #3 — Dual-bind on fresh register (UI roster vs fanout drift)
  //
  // Incident:    2026-05-29 PM @speedyc trip in v4.1 room qexiaw2xpg.
  //              chat_room_members showed @speedyc present; room_memberships
  //              pointed at stale terminal dea7fdf0 while the fresh SpeedyC
  //              terminal t_vjly79fxu9 sat idle.
  // Broken:      Fresh `ant register --name X` creates a new terminal_record
  //              but doesn't rebind existing room_memberships rows for handle
  //              @X. Fanout silently delivers to the dead pane; the UI roster
  //              says the agent is present.
  // v0.2 fix:    SINGLE memberships table (no roster/fanout split). Fanout
  //              target DERIVED from `agents.current_runtime_id` at send
  //              time — never cached on the membership row. PR-B closes the
  //              symptom on the current schema; v0.2 makes the drift state
  //              structurally unrepresentable.
  // ---------------------------------------------------------------------------
  it.todo(
    'Case #3: fresh register cannot produce roster/fanout drift (derived fanout)'
  );

  // ---------------------------------------------------------------------------
  // Case #4 — Six-rooms × stub-id breakage
  //
  // Incident:    2026-05-29 AM bulk fanout rebind across 33 stale bindings
  //              affecting 19 agents in 6+ rooms. Concurrent rebinds collided
  //              on the same `room_memberships.id`.
  // Broken:      Simultaneous rebind operations on the same membership row
  //              can leave one writer's UPDATE invisible to the next reader
  //              if WAL isn't flushed; concurrent sends to the same room
  //              see different terminal_ids.
  // v0.2 fix:    Derived fanout — no cached column to race on. Rebind
  //              operations write an `audit_events` row, not a row UPDATE.
  //              The state being observed is always `agents.current_runtime_id`
  //              at SELECT time, so there is no stale-read window.
  // ---------------------------------------------------------------------------
  it.todo(
    'Case #4: concurrent fanout in 6 rooms with rebind in flight never NULL-resolves'
  );

  // ---------------------------------------------------------------------------
  // Case #5 — Competing-rebind race (instance #4 of 2026-05-29)
  //
  // Incident:    2026-05-29 PM @speedyc msg_r4xqwhayvq — "@cv4 fixing me
  //              broke @codex4 temporarily". An UPDATE on terminals.pid_start
  //              during @codex4's concurrent agentStatusPoller read returned
  //              NULL until codex4 re-registered.
  // Broken:      Write-skew under exact-string equality during UPDATE+SELECT
  //              race window; reader returns NULL between writer's UPDATE-old
  //              and writer's UPDATE-new commits.
  // v0.2 fix:    Derived runtime resolution — no row to UPDATE during the
  //              race. State changes happen via INSERT into audit_events plus
  //              new `runtimes` row, with `agents.current_runtime_id`
  //              swapping atomically (one column, one statement, no race).
  //              Reader sees old-good OR new-good, never NULL.
  // ---------------------------------------------------------------------------
  it.todo(
    'Case #5: concurrent runtime UPDATE + SELECT never returns NULL (atomic swap)'
  );

  // ---------------------------------------------------------------------------
  // Case #6 — Fleet-restart auto-reclaim
  //
  // Incident:    JWPK msg_rj7xtj7krk — "I might need to restart the server...
  //              all the panes will die".
  // Broken:      Server restart leaves every agent's runtime stale. No batch
  //              recovery primitive exists; each agent must individually
  //              re-register and hope no fanout binding drifts. In practice
  //              this turns a 30s bounce into a ~15min cleanup.
  // v0.2 fix:    `ant admin reclaim --all-stale --auto-approve` iterates
  //              agents whose current_runtime went stale and auto-approves
  //              when the new runtime presents a signed challenge that
  //              validates against the agent's `agent_trust_keys`. Atomic
  //              swap; full audit_events trail; memberships untouched.
  // ---------------------------------------------------------------------------
  it.todo(
    'Case #6: fleet reclaim transitions 5 stale agents atomically with audit trail'
  );

  // ---------------------------------------------------------------------------
  // Case #7 — Peer-driven upgrade reclaim
  //
  // Incident:    JWPK msg_rj7xtj7krk — "go and brew upgrade claude in another
  //              terminal, one of you exits the others, then resumes you
  //              either in the same pane or another".
  // Broken:      Peer agent has no path to authorise reclaim on behalf of
  //              another agent during a maintenance window. Old session must
  //              explicitly hand off, which breaks the workflow where the
  //              old session is the one being upgraded.
  // v0.2 fix:    `reclaim_requests` row with `requesting_agent_id !=
  //              agent_id`. Super-admin or a peer holding a `tool_grants` row
  //              for the reclaim capability can authorise. Atomic swap with
  //              full audit trail; both agents' signing keys appear in
  //              audit_events for the swap.
  // ---------------------------------------------------------------------------
  it.todo(
    'Case #7: peer agent with reclaim grant authorises swap for another agent'
  );

  // ---------------------------------------------------------------------------
  // Case #8 — Nifty-orphan-grant (deleted skill still loading)
  //
  // Incident:    JWPK msg_mjh7rgi3wa — "Using nifty. Where did that come
  //              from? That was a memory that I was supposed to have deleted."
  // Broken:      Skills load from filesystem globs (per-Obsidian-vault,
  //              per-machine, per-config). Per-vault deletion doesn't
  //              propagate; cached copies in other locations surface as
  //              ghost capabilities the operator believed they had revoked.
  // v0.2 fix:    `tools` row is the single source of truth. Soft-deleting a
  //              row invalidates every `tool_grants` row referencing it
  //              (FK + status filter on grant lookup). `ant audit orphans`
  //              surfaces grant rows pointing at deleted tools so the leak
  //              is visible.
  // ---------------------------------------------------------------------------
  it.todo(
    'Case #8: soft-deleted tool cannot be invoked AND surfaces in audit orphans'
  );

  // ---------------------------------------------------------------------------
  // Case #9 — Multi-key survives device-revoke (James Stevenson car crash)
  //
  // Incident:    JWPK msg_gtzwsh340p — "James Stevenson was in a car crash
  //              on Wednesday, and his laptop got fucking stuck in the
  //              boot... What happens then?"
  // Broken:      Single trust_pubkey per agent. Lose the private key →
  //              lose the agent forever. No recovery path short of
  //              recreating the identity, which orphans all memberships +
  //              audit history.
  // v0.2 fix:    `agent_trust_keys` table allows N keys per agent with
  //              `key_kind in {device, recovery, hardware, passkey}`.
  //              Revoking one key leaves the others valid; the agent can
  //              sign challenges via any unrevoked key. Passkey integration
  //              via iCloud Keychain restores keys on a new device with
  //              no admin intervention.
  // ---------------------------------------------------------------------------
  it.todo(
    'Case #9: agent with 3 keys signs successfully after one key is revoked'
  );
});
