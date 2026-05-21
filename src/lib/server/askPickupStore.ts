/**
 * askPickupStore — read-time derivation of "who picked up + acted on
 * this answered ask". JWPK ask-pickup notice (msg_kjyh3lmypd → task
 * 3947e563): surface visibility into what happened after JWPK answered
 * an ask, without adding a write path.
 *
 * Definitions:
 *   - "pickup" = any non-system, non-author message posted in the
 *     ask's originating room AFTER `answeredAt`. Best-effort signal —
 *     a true 'read' would need per-handle receipts; this counts
 *     activity-since which is the cheapest correct proxy.
 *   - "distinct agents" = unique authorHandle values across those
 *     messages, minus @system + the operator who answered.
 *   - "first message after" = the chronologically-first qualifying
 *     message, with author + timestamp + truncated body for the UI.
 *
 * Read-only, computed on every request. No migrations.
 */

import { getIdentityDb } from './db';
import { findAskById } from './askStore';

export type AskPickupSummary = {
  askId: string;
  answeredAt: string | null;
  messagesAfterAnswer: number;
  distinctAgentsAfterAnswer: number;
  agentsAfterAnswer: string[];
  firstMessageAfterAnswer: {
    messageId: string;
    authorHandle: string;
    authorDisplayName: string;
    postedAt: string;
    bodyPreview: string;
  } | null;
};

const EMPTY: Omit<AskPickupSummary, 'askId' | 'answeredAt'> = {
  messagesAfterAnswer: 0,
  distinctAgentsAfterAnswer: 0,
  agentsAfterAnswer: [],
  firstMessageAfterAnswer: null
};

export function pickupSummaryForAsk(askId: string): AskPickupSummary {
  const ask = findAskById(askId);
  if (!ask || !ask.answeredAt || ask.status !== 'answered') {
    return { askId, answeredAt: ask?.answeredAt ?? null, ...EMPTY };
  }
  const answeredBy = ask.answeredByHandle ?? null;
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT id, author_handle, author_display_name, body, posted_at
       FROM chat_messages
      WHERE room_id = ?
        AND posted_at > ?
        AND kind = 'human'
        AND (author_handle IS NULL OR author_handle != ?)
        AND (author_handle IS NULL OR author_handle != '@system')
   ORDER BY posted_at ASC
      LIMIT 500`
  ).all(ask.roomId, ask.answeredAt, answeredBy ?? '__no_match__') as {
    id: string;
    author_handle: string;
    author_display_name: string;
    body: string;
    posted_at: string;
  }[];
  if (rows.length === 0) {
    return { askId, answeredAt: ask.answeredAt, ...EMPTY };
  }
  const distinct = new Set<string>();
  for (const r of rows) {
    if (r.author_handle && r.author_handle !== '@system') {
      distinct.add(r.author_handle);
    }
  }
  const first = rows[0];
  return {
    askId,
    answeredAt: ask.answeredAt,
    messagesAfterAnswer: rows.length,
    distinctAgentsAfterAnswer: distinct.size,
    agentsAfterAnswer: [...distinct],
    firstMessageAfterAnswer: {
      messageId: first.id,
      authorHandle: first.author_handle,
      authorDisplayName: first.author_display_name,
      postedAt: first.posted_at,
      bodyPreview: first.body.length > 160 ? `${first.body.slice(0, 160)}…` : first.body
    }
  };
}
