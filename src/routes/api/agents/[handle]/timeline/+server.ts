/**
 * GET /api/agents/:handle/timeline
 *   → scrollable timeline of everything an agent has done
 *   Query: ?limit=50&before=ts (for infinite scroll)
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIdentityDb } from '$lib/server/db';

export const GET: RequestHandler = async ({ params, url }) => {
  const handle = params.handle;
  if (!handle || !handle.startsWith('@')) {
    throw error(400, 'Invalid handle');
  }

  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));
  const before = url.searchParams.get('before');
  const beforeMs = before ? parseInt(before, 10) : null;

  const db = getIdentityDb();

  const entries: Array<{
    ts: number;
    type: string;
    summary: string;
    roomId: string | null;
    roomName: string | null;
    detail: Record<string, unknown>;
  }> = [];

  // Messages
  const msgPlaceholders = beforeMs
    ? 'WHERE author_handle = ? AND strftime(\'%s\', posted_at) * 1000 < ? ORDER BY posted_at DESC LIMIT ?'
    : 'WHERE author_handle = ? ORDER BY posted_at DESC LIMIT ?';
  const msgParams = beforeMs ? [handle, beforeMs, limit] : [handle, limit];
  const msgs = db.prepare(`
    SELECT cm.body, cm.posted_at, cm.room_id, cr.name as room_name
    FROM chat_messages cm
    LEFT JOIN chat_rooms cr ON cr.id = cm.room_id
    ${msgPlaceholders}
  `).all(...msgParams) as Array<{ body: string; posted_at: string; room_id: string; room_name: string | null }>;
  for (const m of msgs) {
    entries.push({
      ts: new Date(m.posted_at).getTime(),
      type: 'message',
      summary: m.body.slice(0, 200),
      roomId: m.room_id,
      roomName: m.room_name,
      detail: { kind: 'chat' }
    });
  }

  // Asks posed
  const askPlaceholders = beforeMs
    ? 'WHERE opened_by_handle = ? AND opened_at_ms < ? ORDER BY opened_at_ms DESC LIMIT ?'
    : 'WHERE opened_by_handle = ? ORDER BY opened_at_ms DESC LIMIT ?';
  const askParams = beforeMs ? [handle, beforeMs, limit] : [handle, limit];
  const asks = db.prepare(`
    SELECT title, body, status, opened_at_ms, room_id
    FROM asks
    ${askPlaceholders}
  `).all(...askParams) as Array<{ title: string; body: string; status: string; opened_at_ms: number; room_id: string }>;
  for (const a of asks) {
    entries.push({
      ts: a.opened_at_ms,
      type: 'ask',
      summary: a.title,
      roomId: a.room_id,
      roomName: null,
      detail: { status: a.status, body: a.body?.slice(0, 200) }
    });
  }

  // Asks answered
  const ansPlaceholders = beforeMs
    ? 'WHERE answered_by_handle = ? AND answered_at_ms IS NOT NULL AND answered_at_ms < ? ORDER BY answered_at_ms DESC LIMIT ?'
    : 'WHERE answered_by_handle = ? AND answered_at_ms IS NOT NULL ORDER BY answered_at_ms DESC LIMIT ?';
  const ansParams = beforeMs ? [handle, beforeMs, limit] : [handle, limit];
  const answers = db.prepare(`
    SELECT title, answer, answered_at_ms, room_id
    FROM asks
    ${ansPlaceholders}
  `).all(...ansParams) as Array<{ title: string; answer: string; answered_at_ms: number; room_id: string }>;
  for (const a of answers) {
    entries.push({
      ts: a.answered_at_ms,
      type: 'answer',
      summary: a.title,
      roomId: a.room_id,
      roomName: null,
      detail: { answer: a.answer?.slice(0, 200) }
    });
  }

  // Tasks
  const taskPlaceholders = beforeMs
    ? 'WHERE assigned_to = ? AND updated_at_ms < ? ORDER BY updated_at_ms DESC LIMIT ?'
    : 'WHERE assigned_to = ? ORDER BY updated_at_ms DESC LIMIT ?';
  const taskParams = beforeMs ? [handle, beforeMs, limit] : [handle, limit];
  const tasks = db.prepare(`
    SELECT subject, description, status, priority, updated_at_ms
    FROM tasks
    ${taskPlaceholders}
  `).all(...taskParams) as Array<{ subject: string; description: string; status: string; priority: number; updated_at_ms: number }>;
  for (const t of tasks) {
    entries.push({
      ts: t.updated_at_ms,
      type: 'task',
      summary: t.subject,
      roomId: null,
      roomName: null,
      detail: { status: t.status, priority: t.priority, description: t.description?.slice(0, 200) }
    });
  }

  // Plans
  const planPlaceholders = beforeMs
    ? 'WHERE created_by = ? AND updated_at_ms < ? AND deleted_at_ms IS NULL ORDER BY updated_at_ms DESC LIMIT ?'
    : 'WHERE created_by = ? AND deleted_at_ms IS NULL ORDER BY updated_at_ms DESC LIMIT ?';
  const planParams = beforeMs ? [handle, beforeMs, limit] : [handle, limit];
  const plans = db.prepare(`
    SELECT title, description, updated_at_ms
    FROM plans
    ${planPlaceholders}
  `).all(...planParams) as Array<{ title: string; description: string; updated_at_ms: number }>;
  for (const p of plans) {
    entries.push({
      ts: p.updated_at_ms,
      type: 'plan',
      summary: p.title,
      roomId: null,
      roomName: null,
      detail: { description: p.description?.slice(0, 200) }
    });
  }

  // Run events via terminal_id → room_memberships
  const tids = db.prepare(`SELECT DISTINCT terminal_id FROM room_memberships WHERE handle = ?`).all(handle) as Array<{ terminal_id: string }>;
  if (tids.length > 0) {
    const placeholders = tids.map(() => '?').join(',');
    const evPlaceholders = beforeMs
      ? `WHERE terminal_id IN (${placeholders}) AND ts_ms < ? ORDER BY ts_ms DESC LIMIT ?`
      : `WHERE terminal_id IN (${placeholders}) ORDER BY ts_ms DESC LIMIT ?`;
    const evParams = beforeMs
      ? [...tids.map(t => t.terminal_id), beforeMs, limit]
      : [...tids.map(t => t.terminal_id), limit];
    const events = db.prepare(`
      SELECT kind, text, ts_ms, terminal_id
      FROM terminal_run_events
      ${evPlaceholders}
    `).all(...evParams) as Array<{ kind: string; text: string; ts_ms: number; terminal_id: string }>;
    for (const e of events) {
      entries.push({
        ts: e.ts_ms,
        type: e.kind || 'event',
        summary: e.text?.slice(0, 200) || '',
        roomId: null,
        roomName: null,
        detail: { terminalId: e.terminal_id }
      });
    }
  }

  entries.sort((a, b) => b.ts - a.ts);
  const result = entries.slice(0, limit);

  return json({
    handle,
    entries: result,
    hasMore: entries.length > limit,
    nextBefore: result.length > 0 ? result[result.length - 1].ts : null,
  });
};
