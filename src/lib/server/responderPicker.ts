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

export function pickNextResponder(
  responders: ResponderWithStatus[],
  senderHandle: string | null
): ResponderWithStatus | null {
  for (const responder of responders) {
    if (responder.handle === senderHandle) continue;
    if (responder.pane_status !== 'verified') continue;
    return responder;
  }
  return null;
}
