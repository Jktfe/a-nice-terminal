// Phase A of server-split-2026-05-11 — sender resolution. Lifted
// verbatim from +server.ts:121-129. Lives in the persist library so
// writeMessage() can return a fully-resolved sender as part of its
// WriteMessageResult without the caller having to redo the lookup.

import { queries } from '$lib/server/db';
import type { SenderResolved } from './types.js';

export function resolveSenderSession(senderId: string | null): SenderResolved {
  if (!senderId) {
    return { name: 'web user', type: null };
  }
  const session: any =
    queries.getSession(senderId) || queries.getSessionByHandle(senderId);
  return {
    name: session?.display_name || session?.name || senderId,
    type: session?.type || null,
  };
}
