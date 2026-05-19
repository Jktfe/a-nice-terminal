// ANT — Agent Timeline API
// GET /api/agents/:name/timeline — Scrollable timeline entries for a specific agent

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';

interface TimelineEntry {
  ts: number;
  type: string;
  summary: string;
  sessionId?: string;
  roomId?: string;
  metadata?: Record<string, unknown>;
}

function getDb() {
  return (queries as any).getDb?.() || null;
}

export async function GET(event: RequestEvent<{ name: string }>) {
  const handle = event.params.name;
  const url = event.url;
  const before = url.searchParams.get('before');
  const after = url.searchParams.get('after');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

  const db = getDb();
  if (!db) return json({ timeline: [], hasMore: false });

  try {
    const entries: TimelineEntry[] = [];

    // Messages from this agent
    const msgWhere: string[] = ['author_handle = ?'];
    const msgParams: any[] = [handle];
    if (before) { msgWhere.push('posted_at <= ?'); msgParams.push(before); }
    if (after) { msgWhere.push('posted_at >= ?'); msgParams.push(after); }

    const msgs = db.prepare(`
      SELECT id, posted_at, body, room_id, kind
      FROM chat_messages
      WHERE ${msgWhere.join(' AND ')}
      ORDER BY posted_at DESC
      LIMIT ?
    `).all(...msgParams, limit);

    for (const m of msgs as any[]) {
      entries.push({
        ts: new Date(m.posted_at).getTime(),
        type: 'message',
        summary: (m.body || '').slice(0, 120),
        roomId: m.room_id,
      });
    }

    // Asks posed by this agent
    const asks = db.prepare(`
      SELECT id, opened_at_ms, title, room_id, resolved_at_ms
      FROM asks
      WHERE opened_by_handle = ?
      ORDER BY opened_at_ms DESC
      LIMIT ?
    `).all(handle, limit);

    for (const a of asks as any[]) {
      entries.push({
        ts: a.opened_at_ms || 0,
        type: a.resolved_at_ms ? 'ask_answered' : 'ask_posed',
        summary: a.title || 'Ask',
        roomId: a.room_id,
      });
    }

    // Tasks
    const tasks = db.prepare(`
      SELECT id, created_at_ms, title, status, room_id
      FROM tasks
      WHERE assignee_handle = ? OR opened_by_handle = ?
      ORDER BY created_at_ms DESC
      LIMIT ?
    `).all(handle, handle, limit);

    for (const t of tasks as any[]) {
      entries.push({
        ts: t.created_at_ms || 0,
        type: t.status === 'completed' ? 'task_completed' : 'task_started',
        summary: t.title || 'Task',
        roomId: t.room_id,
      });
    }

    // Plans
    const plans = db.prepare(`
      SELECT id, created_at_ms, title, room_id
      FROM plans
      WHERE created_by_handle = ?
      ORDER BY created_at_ms DESC
      LIMIT ?
    `).all(handle, limit);

    for (const p of plans as any[]) {
      entries.push({
        ts: p.created_at_ms || 0,
        type: 'plan_created',
        summary: p.title || 'Plan',
        roomId: p.room_id,
      });
    }

    // Reactions received
    const reactions = db.prepare(`
      SELECT mr.id, mr.created_at_ms, mr.reaction, mr.message_id
      FROM message_reactions mr
      JOIN chat_messages cm ON cm.id = mr.message_id
      WHERE cm.author_handle = ?
      ORDER BY mr.created_at_ms DESC
      LIMIT ?
    `).all(handle, limit);

    for (const r of reactions as any[]) {
      entries.push({
        ts: r.created_at_ms || 0,
        type: 'reaction_received',
        summary: `Received ${r.reaction}`,
      });
    }

    // Sort by timestamp descending
    entries.sort((a, b) => b.ts - a.ts);

    const hasMore = entries.length >= limit;
    const timeline = entries.slice(0, limit);

    return json({ timeline, hasMore });
  } catch (err) {
    console.error('Agent timeline API error:', err);
    return json({ timeline: [], hasMore: false });
  }
}
