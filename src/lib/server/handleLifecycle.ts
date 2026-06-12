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
