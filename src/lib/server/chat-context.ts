import getDb, { queries } from './db.js';

export const CHAT_BREAK_MSG_TYPE = 'chat_break';

export interface AgentContextMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  format: string;
  status: string;
  sender_id: string | null;
  target: string | null;
  reply_to: string | null;
  msg_type: string;
  meta?: string | null;
  created_at: string;
}

export interface LoadMessagesForAgentContextOptions {
  /**
   * Defaults to the room's sessions.long_memory flag. Override is useful for
   * tests and for explicit full-history tools.
   */
  longMemory?: boolean;
  /** Include the break marker itself in the returned context. Default false. */
  includeBreakMarker?: boolean;
  /** Cap returned rows after break filtering, keeping the newest N rows. */
  limit?: number;
  /** Optional lower timestamp bound, applied after the latest break boundary. */
  since?: string | null;
}

export function roomLongMemoryEnabled(roomId: string): boolean {
  const session = queries.getSession(roomId) as { long_memory?: number | boolean | null } | undefined;
  return session?.long_memory === true || Number(session?.long_memory ?? 0) === 1;
}

function normalizeLimit(limit: number | undefined): number | null {
  if (!Number.isFinite(limit)) return null;
  const value = Math.floor(Number(limit));
  return value > 0 ? value : null;
}

export function loadMessagesForAgentContext(
  roomId: string,
  opts: LoadMessagesForAgentContextOptions = {},
): AgentContextMessage[] {
  const db = getDb();
  const longMemory = opts.longMemory ?? roomLongMemoryEnabled(roomId);
  const limit = normalizeLimit(opts.limit);
  const conditions = ['session_id = ?'];
  const params: unknown[] = [roomId];

  if (!longMemory) {
    const breakRow = db.prepare(`
      SELECT rowid
      FROM messages
      WHERE session_id = ? AND msg_type = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get(roomId, CHAT_BREAK_MSG_TYPE) as { rowid: number } | undefined;

    if (breakRow) {
      conditions.push(`rowid ${opts.includeBreakMarker ? '>=' : '>'} ?`);
      params.push(breakRow.rowid);
    }
  }

  if (opts.since) {
    conditions.push('created_at > ?');
    params.push(opts.since);
  }

  const rows = db.prepare(`
    SELECT *
    FROM messages
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at ASC, rowid ASC
  `).all(...params) as AgentContextMessage[];

  return limit && rows.length > limit ? rows.slice(-limit) : rows;
}
