// Phase A of server-split-2026-05-11 — auto-populate chat_room_members
// when a sender posts. Extracted from +server.ts:388-401. The
// swallow-on-error policy is preserved verbatim: membership upsert is
// best-effort, the message post must never fail because membership
// could not be touched.

import { queries } from '$lib/server/db';

export function ensureRoomMembershipForSender(roomId: string, senderId: string | null): void {
  if (!senderId) return;
  try {
    const senderSess: any =
      queries.getSession(senderId) || queries.getSessionByHandle(senderId);
    if (!senderSess) return;
    const memberRole = senderSess.type === 'terminal' ? 'participant' : 'external';
    let cliFlag: string | null = null;
    try {
      cliFlag = senderSess.cli_flag || JSON.parse(senderSess.meta || '{}').agent_driver || null;
    } catch {
      // sender meta may be malformed; cliFlag stays null
    }
    const alias = senderSess.handle || null;
    queries.addRoomMember(roomId, senderSess.id, memberRole, cliFlag, alias);
  } catch {
    // Best-effort — see comment above.
  }
}
