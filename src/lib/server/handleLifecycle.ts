/**
 * handleLifecycle — the ANThandle lifecycle verbs (RULED by JWPK via fClaude
 * msg_as5tbdtaf9, 2026-06-12). The handle's OWN state (active / retired /
 * deleted) is a separate layer from its BINDING state (bound / vacant); these
 * verbs operate on the lifecycle layer. RECLAIM keeps its narrow meaning in the
 * witness layer (re-seating a VACANT handle after pane death) and is NOT here.
 *
 * This increment lands RETIRE — the verb that makes removal actually STICK.
 * A handle's identity spans three stores; a "killed" terminal lingered because
 * only the first was ever updated on death (JWPK msg_0iikis5683):
 *   1. room_handle_lease  — the room claims the POST-gate reads (squatted),
 *   2. handle_bindings     — the witnessed binding (released only by the pane
 *      death-witness, which may never fire for a quietly-killed pane),
 *   3. identity_ledger     — the permanent audit ("was there someone, when did
 *      they go" must stay answerable forever — the bank/regulator requirement).
 *
 * retireHandle sweeps #1 across every room, tombstones #2, and writes one #3
 * row, in a single transaction. It composes the existing per-room lease retire
 * and binding tombstone — the new part is the all-rooms sweep, the ledger, and
 * a single auditable summary. Same body serves the operator's Retire button and
 * the automatic release-on-death wiring (a later increment calls this).
 */

import { getIdentityDb } from './db';
import {
  listActiveLeaseRoomsForHandle,
  retireActiveLeasesForHandle
} from './roomHandleLeaseClean';
import { getLiveBinding, tombstoneBinding } from './handleBindingsStore';
import { appendLedger } from './identityLedgerStore';

function canonicalHandle(raw: string): string {
  return `@${raw.trim().replace(/^@+/, '')}`;
}

export type RetireHandleResult = {
  /** The canonical (@-prefixed) handle that was retired. */
  handle: string;
  /** How many rooms held an active claim for this handle before retire. */
  roomsRetired: number;
  /** Total active room_handle_lease rows flipped to retired across all rooms. */
  leasesRetired: number;
  /** Whether a live witnessed binding existed and was tombstoned. */
  bindingTombstoned: boolean;
};

/**
 * RETIRE: unassign a handle everywhere. Every active room claim is retired, the
 * witnessed binding (if any) is tombstoned, and the act is ledgered. Idempotent
 * — re-retiring a handle that holds nothing returns a zero summary and still
 * leaves an audit row (the operator's intent is itself worth recording).
 *
 * `reason` is the death/removal evidence ('operator-retire', 'terminal-killed',
 * …); `actor` is who authorised it (an operator handle, or 'daemon' for the
 * automatic death path).
 */
export function retireHandle(
  rawHandle: string,
  opts: { reason: string; actor: string; atMs?: number },
  db = getIdentityDb()
): RetireHandleResult {
  const handle = canonicalHandle(rawHandle);
  const nowMs = opts.atMs ?? Date.now();
  const run = db.transaction((): RetireHandleResult => {
    // Every room this handle still holds an ACTIVE claim in — read straight
    // from the post-gate's own table so we retire exactly what could still
    // post, not what some parallel membership table believes.
    const rooms = listActiveLeaseRoomsForHandle(handle, db);
    let leasesRetired = 0;
    for (const room_id of rooms) {
      leasesRetired += retireActiveLeasesForHandle(room_id, handle, db);
    }
    const bindingTombstoned = getLiveBinding(handle) !== null
      ? tombstoneBinding(handle, opts.reason, nowMs)
      : false;
    // Flip the handle's OWN lifecycle to RETIRED — the layer that distinguishes
    // "killed, owner-gated reclaim, name still taken" from a merely-vacant
    // active handle. Upsert so retiring a handle with leases but no handles row
    // still records the state.
    db.prepare(
      `INSERT INTO handles (handle, created_at_ms, created_by, lifecycle)
       VALUES (?, ?, NULL, 'retired')
       ON CONFLICT(handle) DO UPDATE SET lifecycle = 'retired'`
    ).run(handle, nowMs);
    appendLedger({
      kind: 'handle.retired',
      handle,
      actor: opts.actor,
      atMs: nowMs,
      detail: {
        reason: opts.reason,
        rooms_retired: rooms.length,
        leases_retired: leasesRetired,
        binding_tombstoned: bindingTombstoned
      }
    });
    return { handle, roomsRetired: rooms.length, leasesRetired, bindingTombstoned };
  });
  return run();
}

export type DeleteHandleResult = {
  /** The canonical (@-prefixed) handle that was deleted. */
  handle: string;
  /** The monotonic anonymisation id — posts render `[A{anonId}]`, member/lease
   *  lists render `[A-{anonId}]`. Stable per handle, never reused. */
  anonId: number;
  /** chat_messages rows whose author was rewritten to `[A{anonId}]`. */
  chatPostsAnonymised: number;
  /** message_reactions rows whose reactor was rewritten to `[A{anonId}]`. */
  reactionsAnonymised: number;
  /** chat_room_members rows removed (a deleted handle is no longer "here"). */
  memberRowsRemoved: number;
  /** legacy room_memberships rows removed. */
  membershipRowsRemoved: number;
  /** room_handle_lease rows rewritten to the unclaimable `[A-{anonId}]`. */
  leasesAnonymised: number;
  /** terminal_records rows whose handle was NULLed (frees the unique index). */
  terminalRecordsNulled: number;
  /** v0.2 agents rows flipped to status='deleted'. */
  agentsMarkedDeleted: number;
  /** Whether a live witnessed binding existed and was tombstoned. */
  bindingTombstoned: boolean;
};

/**
 * DELETE: anonymise a handle and free its name. Unlike RETIRE (which only flips
 * lease/binding/lifecycle state), DELETE rewrites the handle's snapshotted
 * identity out of the content tables — chat posts and reactions render `[A{n}]`,
 * member/lease lists render the unclaimable `[A-{n}]` — because post identity is
 * written verbatim at post time, not re-resolved at read. The original name is
 * freed for reuse (a fresh bind re-activates the handles row); the `[A-{n}]`
 * placeholder itself is never registerable. The act is ledgered forever.
 *
 * One anonymisation id per handle (so every post by it collapses to the same
 * `[A{n}]`), derived monotonically from prior `handle.deleted` ledger rows and
 * recorded in the new row — which makes a re-delete idempotent (it reuses the id
 * and writes no second row).
 */
export function deleteHandle(
  rawHandle: string,
  opts: { reason: string; actor: string; atMs?: number },
  db = getIdentityDb()
): DeleteHandleResult {
  const handle = canonicalHandle(rawHandle);
  const nowMs = opts.atMs ?? Date.now();
  const run = db.transaction((): DeleteHandleResult => {
    // Reuse the anon id if this handle was already deleted (idempotent); else
    // take the next free integer across every prior handle.deleted row.
    const prior = db
      .prepare(`SELECT detail FROM identity_ledger WHERE kind = 'handle.deleted' AND handle = ? LIMIT 1`)
      .get(handle) as { detail: string | null } | undefined;
    const priorAnonId = prior?.detail
      ? (JSON.parse(prior.detail) as { anon_id?: number }).anon_id
      : undefined;
    const anonId =
      priorAnonId ??
      (((db
        .prepare(
          `SELECT MAX(CAST(json_extract(detail, '$.anon_id') AS INTEGER)) AS m
             FROM identity_ledger WHERE kind = 'handle.deleted'`
        )
        .get() as { m: number | null }).m ?? 0) +
        1);
    const postLabel = `[A${anonId}]`;
    const listLabel = `[A-${anonId}]`;

    // Chat posts — rewrite the snapshotted author identity (both routing handle
    // and display name) so the deleted name leaks nowhere in rendered history.
    const chatPostsAnonymised = db
      .prepare(
        `UPDATE chat_messages SET author_handle = ?, author_display_name = ?
          WHERE author_handle = ?`
      )
      .run(postLabel, postLabel, handle).changes;

    // Reactions — PK is (message_id, reactor_handle, emoji); OR IGNORE then drop
    // any leftover so a (theoretical) collision can never throw or linger.
    const reactionsAnonymised = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM message_reactions WHERE reactor_handle = ?`)
        .get(handle) as { n: number }
    ).n;
    db.prepare(`UPDATE OR IGNORE message_reactions SET reactor_handle = ? WHERE reactor_handle = ?`)
      .run(postLabel, handle);
    db.prepare(`DELETE FROM message_reactions WHERE reactor_handle = ?`).run(handle);

    // Member / handle lists — a deleted handle is no longer present.
    const memberRowsRemoved = db
      .prepare(`DELETE FROM chat_room_members WHERE handle = ?`)
      .run(handle).changes;
    const membershipRowsRemoved = db
      .prepare(`DELETE FROM room_memberships WHERE handle = ?`)
      .run(handle).changes;

    // Leases — rewrite the base handle to the unclaimable [A-{n}] and retire it.
    // This both frees the original name in the active-handle unique index and
    // keeps historical post rendering pointing at the tombstone label. The read
    // also lazily creates room_handle_lease on a fresh DB that never minted one.
    listActiveLeaseRoomsForHandle(handle, db);
    const leasesAnonymised = db
      .prepare(
        `UPDATE room_handle_lease
            SET handle = ?, active = 0, retired_at_ms = COALESCE(retired_at_ms, ?)
          WHERE handle = ?`
      )
      .run(listLabel, nowMs, handle).changes;

    // Durable identity rows — NULL the terminal binding, mark the agent deleted.
    const terminalRecordsNulled = db
      .prepare(`UPDATE terminal_records SET handle = NULL, updated_at_ms = ? WHERE handle = ?`)
      .run(nowMs, handle).changes;
    const agentsMarkedDeleted = db
      .prepare(`UPDATE agents SET status = 'deleted' WHERE primary_handle = ?`)
      .run(handle).changes;

    // Witnessed binding + handle lifecycle.
    const bindingTombstoned =
      getLiveBinding(handle) !== null ? tombstoneBinding(handle, opts.reason, nowMs) : false;
    db.prepare(
      `INSERT INTO handles (handle, created_at_ms, created_by, lifecycle, vacated_at_ms)
       VALUES (?, ?, NULL, 'deleted', ?)
       ON CONFLICT(handle) DO UPDATE SET lifecycle = 'deleted', vacated_at_ms = ?`
    ).run(handle, nowMs, nowMs, nowMs);

    // Ledger once — a re-delete (prior row present) reuses the id and adds none.
    if (!prior) {
      appendLedger({
        kind: 'handle.deleted',
        handle,
        actor: opts.actor,
        atMs: nowMs,
        detail: {
          reason: opts.reason,
          anon_id: anonId,
          chat_posts_anonymised: chatPostsAnonymised,
          reactions_anonymised: reactionsAnonymised,
          member_rows_removed: memberRowsRemoved,
          membership_rows_removed: membershipRowsRemoved,
          leases_anonymised: leasesAnonymised,
          terminal_records_nulled: terminalRecordsNulled,
          agents_marked_deleted: agentsMarkedDeleted,
          binding_tombstoned: bindingTombstoned,
          name_freed: true
        }
      });
    }

    return {
      handle,
      anonId,
      chatPostsAnonymised,
      reactionsAnonymised,
      memberRowsRemoved,
      membershipRowsRemoved,
      leasesAnonymised,
      terminalRecordsNulled,
      agentsMarkedDeleted,
      bindingTombstoned
    };
  });
  return run();
}
