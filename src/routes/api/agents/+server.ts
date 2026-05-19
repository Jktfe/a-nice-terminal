// ANT v4 — Fleet API
// GET /api/agents — Aggregate agent registry with room membership, messages, asks, tasks, plans, reactions, and terminal activity
// Returns shape compatible with AgentGrid / AgentStrip / AgentDetailDrawer components

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';

interface RoomActivity {
  roomId: string;
  roomName: string;
  messageCount: number;
  lastActivity: number | null;
  attentionState: 'focused' | 'available' | 'idle' | null;
  role: string;
}

interface TimelineEntry {
  ts: number;
  type: string;
  summary: string;
  sessionId?: string;
}

interface AgentCardData {
  name: string;
  tier: 1 | 2 | 3;
  available: boolean;
  launchCommand: string;
  driverPath: string;
  specPath: string | null;
  currentStatus: {
    sessionId?: string;
    model?: string;
    contextUsedPct?: number;
    state: string;
    stateLabel?: string;
    activity?: string;
    workspace?: string;
    sessionDurationMs?: number;
    permissionMode?: string;
    remoteControlActive?: boolean;
    hookFreshness: 'live' | 'stale' | 'absent';
    detectedAt?: number;
  } | null;
  stats: {
    messagesSent24h: number;
    messagesReceived24h: number;
    asksPosed: number;
    asksAnswered: number;
    asksOpen: number;
    tasksCompleted: number;
    tasksInProgress: number;
    plansCreated: number;
    positiveReactions: number;
    totalSessions: number;
    activeSessions: number;
    totalRooms: number;
  };
  rooms: RoomActivity[];
  mostActiveRooms: RoomActivity[];
  timeline: TimelineEntry[];
}

function getDb() {
  return (queries as any).getDb?.() || null;
}

function inferTier(handle: string): 1 | 2 | 3 {
  if (handle.startsWith('@ant') && !handle.startsWith('@evolveant')) return 2;
  return 1;
}

function getAgentHandles(): string[] {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = db.prepare(`SELECT DISTINCT handle FROM chat_room_members WHERE kind = 'agent'`).all();
    return (rows as any[]).map(r => r.handle);
  } catch (e) {
    console.error('getAgentHandles error:', e);
    return [];
  }
}

function getAgentRooms(handle: string): RoomActivity[] {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT
        crm.room_id as roomId,
        COALESCE(cr.name, 'Unknown') as roomName,
        COUNT(cm.id) as messageCount,
        MAX(cm.posted_at) as lastActivity,
        'participant' as role
      FROM chat_room_members crm
      LEFT JOIN chat_rooms cr ON cr.id = crm.room_id
      LEFT JOIN chat_messages cm ON cm.room_id = crm.room_id AND cm.author_handle = ?
      WHERE crm.handle = ?
      GROUP BY crm.room_id
      ORDER BY messageCount DESC
    `).all(handle, handle);
    return (rows as any[]).map(r => ({
      roomId: r.roomId,
      roomName: r.roomName,
      messageCount: r.messageCount || 0,
      lastActivity: r.lastActivity ? new Date(r.lastActivity).getTime() : null,
      attentionState: null as 'focused' | 'available' | 'idle' | null,
      role: r.role || 'participant'
    }));
  } catch (e) {
    console.error('getAgentRooms error:', e);
    return [];
  }
}

function getMessageCounts(handle: string, windowHours = 24) {
  const db = getDb();
  if (!db) return { sent: 0, received: 0 };
  try {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
    const sent = db.prepare(`SELECT COUNT(*) as c FROM chat_messages WHERE author_handle = ? AND posted_at >= ?`).get(handle, since);
    const received = db.prepare(`SELECT COUNT(*) as c FROM chat_messages WHERE author_handle != ? AND room_id IN (SELECT room_id FROM chat_room_members WHERE handle = ?) AND posted_at >= ?`).get(handle, handle, since);
    return { sent: sent?.c || 0, received: received?.c || 0 };
  } catch (e) {
    console.error('getMessageCounts error:', e);
    return { sent: 0, received: 0 };
  }
}

function getAskStats(handle: string) {
  const db = getDb();
  if (!db) return { posed: 0, answered: 0, open: 0 };
  try {
    const posed = db.prepare(`SELECT COUNT(*) as c FROM asks WHERE opened_by_handle = ?`).get(handle);
    const answered = db.prepare(`SELECT COUNT(*) as c FROM asks WHERE answered_by_handle = ?`).get(handle);
    const open = db.prepare(`SELECT COUNT(*) as c FROM asks WHERE opened_by_handle = ? AND status = 'open'`).get(handle);
    return { posed: posed?.c || 0, answered: answered?.c || 0, open: open?.c || 0 };
  } catch (e) {
    console.error('getAskStats error:', e);
    return { posed: 0, answered: 0, open: 0 };
  }
}

function getTaskStats(handle: string) {
  const db = getDb();
  if (!db) return { completed: 0, inProgress: 0 };
  try {
    const completed = db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE assigned_to = ? AND status = 'completed'`).get(handle);
    const inProgress = db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE assigned_to = ? AND status != 'completed' AND status != 'deleted'`).get(handle);
    return { completed: completed?.c || 0, inProgress: inProgress?.c || 0 };
  } catch (e) {
    console.error('getTaskStats error:', e);
    return { completed: 0, inProgress: 0 };
  }
}

function getPlanCount(handle: string) {
  const db = getDb();
  if (!db) return 0;
  try {
    const row = db.prepare(`SELECT COUNT(*) as c FROM plans WHERE created_by = ?`).get(handle);
    return row?.c || 0;
  } catch (e) {
    console.error('getPlanCount error:', e);
    return 0;
  }
}

function getReactionsReceived(handle: string) {
  const db = getDb();
  if (!db) return 0;
  try {
    const row = db.prepare(`
      SELECT COUNT(*) as c
      FROM chat_message_reactions cmr
      JOIN chat_messages cm ON cm.id = cmr.message_id
      WHERE cm.author_handle = ? AND cmr.emoji IN ('👍','💯','🎉','❤️','🔥')
    `).get(handle);
    return row?.c || 0;
  } catch (e) {
    console.error('getReactionsReceived error:', e);
    return 0;
  }
}

function getTerminalIdsForHandle(handle: string): string[] {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = db.prepare(`SELECT DISTINCT terminal_id FROM room_memberships WHERE handle = ?`).all(handle);
    return (rows as any[]).map(r => r.terminal_id);
  } catch (e) {
    console.error('getTerminalIdsForHandle error:', e);
    return [];
  }
}

function getTerminalStatus(terminalIds: string[]) {
  if (terminalIds.length === 0) return null;
  const db = getDb();
  if (!db) return null;
  try {
    const placeholders = terminalIds.map(() => '?').join(',');
    const row = db.prepare(`
      SELECT id, agent_status, agent_kind, meta, last_message_sent_at_ms, last_fingerprint_at_ms, created_at
      FROM terminals
      WHERE id IN (${placeholders})
      ORDER BY last_message_sent_at_ms DESC
      LIMIT 1
    `).get(...terminalIds);
    if (!row) return null;
    let workspace = null;
    let activity = null;
    try {
      const meta = JSON.parse(row.meta || '{}');
      workspace = meta.cwd ? meta.cwd.split('/').pop() : null;
      activity = meta.activity || null;
    } catch {}
    const now = Date.now();
    const lastMsg = row.last_message_sent_at_ms || 0;
    const freshness: 'live' | 'stale' | 'absent' = lastMsg > 0
      ? (now - lastMsg < 30000 ? 'live' : now - lastMsg < 300000 ? 'stale' : 'absent')
      : 'absent';
    return {
      sessionId: row.id,
      model: row.agent_kind || undefined,
      state: row.agent_status || 'idle',
      stateLabel: row.agent_status || undefined,
      activity: activity || undefined,
      workspace: workspace || undefined,
      sessionDurationMs: row.created_at ? now - row.created_at * 1000 : undefined,
      hookFreshness: freshness,
      detectedAt: row.last_fingerprint_at_ms || undefined
    };
  } catch (e) {
    console.error('getTerminalStatus error:', e);
    return null;
  }
}

function getTimeline(handle: string, terminalIds: string[], limit = 50): TimelineEntry[] {
  const db = getDb();
  if (!db) return [];
  const entries: TimelineEntry[] = [];
  try {
    const msgs = db.prepare(`
      SELECT posted_at as ts, room_id, body
      FROM chat_messages
      WHERE author_handle = ?
      ORDER BY posted_at DESC
      LIMIT ?
    `).all(handle, limit);
    for (const m of msgs as any[]) {
      entries.push({ ts: new Date(m.ts).getTime(), type: 'message', summary: m.body?.slice(0, 120) || '', sessionId: m.room_id });
    }
    if (terminalIds.length > 0) {
      const placeholders = terminalIds.map(() => '?').join(',');
      const events = db.prepare(`
        SELECT ts_ms as ts, kind, text, terminal_id
        FROM terminal_run_events
        WHERE terminal_id IN (${placeholders})
        ORDER BY ts_ms DESC
        LIMIT ?
      `).all(...terminalIds, limit);
      for (const e of events as any[]) {
        entries.push({ ts: e.ts, type: e.kind || 'event', summary: e.text?.slice(0, 120) || '', sessionId: e.terminal_id });
      }
    }
    const asks = db.prepare(`
      SELECT opened_at_ms as ts, title, room_id
      FROM asks
      WHERE opened_by_handle = ?
      ORDER BY opened_at_ms DESC
      LIMIT ?
    `).all(handle, limit);
    for (const a of asks as any[]) {
      entries.push({ ts: a.ts, type: 'ask', summary: a.title || 'Ask', sessionId: a.room_id });
    }
    entries.sort((a, b) => b.ts - a.ts);
    return entries.slice(0, limit);
  } catch (e) {
    console.error('getTimeline error:', e);
    return [];
  }
}

export async function GET(event: RequestEvent) {
  try {
    const handles = getAgentHandles();
    const agents: AgentCardData[] = [];
    for (const handle of handles) {
      const rooms = getAgentRooms(handle);
      const msgCounts = getMessageCounts(handle);
      const askStats = getAskStats(handle);
      const taskStats = getTaskStats(handle);
      const planCount = getPlanCount(handle);
      const reactions = getReactionsReceived(handle);
      const terminalIds = getTerminalIdsForHandle(handle);
      const status = getTerminalStatus(terminalIds);
      const timeline = getTimeline(handle, terminalIds);

      agents.push({
        name: handle,
        tier: inferTier(handle),
        available: true,
        launchCommand: '',
        driverPath: '',
        specPath: null,
        currentStatus: status,
        stats: {
          messagesSent24h: msgCounts.sent,
          messagesReceived24h: msgCounts.received,
          asksPosed: askStats.posed,
          asksAnswered: askStats.answered,
          asksOpen: askStats.open,
          tasksCompleted: taskStats.completed,
          tasksInProgress: taskStats.inProgress,
          plansCreated: planCount,
          positiveReactions: reactions,
          totalSessions: terminalIds.length,
          activeSessions: terminalIds.length,
          totalRooms: rooms.length
        },
        rooms: rooms.slice(0, 5),
        mostActiveRooms: rooms.slice(0, 5),
        timeline: timeline.slice(0, 20)
      });
    }

    agents.sort((a, b) => {
      const aTs = a.timeline[0]?.ts || 0;
      const bTs = b.timeline[0]?.ts || 0;
      return bTs - aTs;
    });

    const summary = {
      totalAgents: agents.length,
      availableCount: agents.length,
      activeCount: agents.filter(a => a.currentStatus?.stateLabel === 'working' || a.currentStatus?.state === 'working').length,
      focusRoomCount: agents.reduce((sum, a) => sum + a.rooms.filter(r => r.attentionState === 'focused').length, 0)
    };

    return json({ agents, summary });
  } catch (err) {
    console.error('Fleet API error:', err);
    return json({ message: 'Internal Error', detail: String(err) }, { status: 500 });
  }
}
