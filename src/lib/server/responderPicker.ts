/**
 * responderPicker — pure function for the heads-down routing decision per
 * the responders design contract 2026-05-13 (M3.b.5).
 *
 * Pure means: no DB calls, no fanout knowledge, no side effects. The caller
 * (pty-inject-fanout) does the JOIN of chat_room_responders + terminals (for
 * pane_status) + room_memberships (for handle) and passes the joined list
 * in. The picker walks the ordered list and returns the first entry whose
 * pane_status is 'verified' AND whose handle is not the sender's, or null.
 *
 * Null covers BOTH "empty list" AND "no-verified-non-sender" — the picker
 * does NOT distinguish (Q8 B3 lock). The caller (fanout) decides what to do
 * with null per JWPK-C: emit rate-limited no-responder marker + return.
 *
 * Tests live in responderPicker.test.ts.
 */

export type ResponderWithStatus = {
  terminal_id: string;
  order_index: number;
  pane_status: 'unknown' | 'verified' | 'stale';
  handle: string;
};

export type ResponderPickerOpts = {
  /** Handles that have explicitly passed on this message — skip them. */
  passHandles?: Set<string>;
  /** handle → claimed_at_ms for active working claims. Claims older than
   *  autoPassWorkingMs are treated as passed (no-response timeout). */
  workingHandles?: Map<string, number>;
  /** How long a working claim can sit without response before it is
   *  treated as a pass. Default: 30 000 ms. */
  autoPassWorkingMs?: number;
};

export function pickNextResponder(
  responders: ResponderWithStatus[],
  senderHandle: string | null,
  opts: ResponderPickerOpts = {}
): ResponderWithStatus | null {
  const passSet = opts.passHandles ?? new Set<string>();
  const workingMap = opts.workingHandles ?? new Map<string, number>();
  const autoPassMs = opts.autoPassWorkingMs ?? 30_000;
  const nowMs = Date.now();

  for (const responder of responders) {
    if (responder.handle === senderHandle) continue;
    if (responder.pane_status !== 'verified') continue;
    if (passSet.has(responder.handle)) continue;
    const workingAtMs = workingMap.get(responder.handle);
    if (workingAtMs !== undefined && nowMs - workingAtMs > autoPassMs) {
      continue; // auto-pass: working claim with no response within window
    }
    return responder;
  }
  return null;
}
