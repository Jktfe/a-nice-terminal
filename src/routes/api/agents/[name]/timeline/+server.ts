// ANT — Agent Timeline API
// GET /api/agents/:name/timeline — Scrollable timeline of agent activity

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { assertNotRoomScoped } from '$lib/server/room-scope.js';

interface TimelineEntry {
  ts: number;
  type: string;
  summary: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

function getAgentSessions(agentName: string) {
  const allSessions = queries.listSessions() as any[];
  return allSessions.filter(s => {
    if (s.type !== 'terminal') return false;
    try {
      const meta = typeof s.meta === 'string' ? JSON.parse(s.meta) : s.meta;
      const driver = meta?.agent_driver;
      if (!driver) return false;
      const normalized = driver === 'copilot' ? 'copilot-cli' : driver === 'qwen' ? 'qwen-cli' : driver;
      return normalized === agentName;
    } catch {
      return false;
    }
  });
}

function getHistoricalRooms(agentName: string) {
  const db = (queries as any).getDb?.() || null;
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT DISTINCT
        crm.room_id,
        r.name as room_name,
        COUNT(m.id) as message_count,
        MIN(m.created_at) as first_activity,
        MAX(m.created_at) as last_activity,
        crm.role
      FROM chat_room_members crm
      LEFT JOIN chat_rooms r ON r.id = crm.room_id
      LEFT JOIN messages m ON m.chat_id = crm.room_id AND m.sender_handle = ?
      WHERE crm.member_handle = ?
      GROUP BY crm.room_id, r.name, crm.role
      ORDER BY last_activity DESC
    `).all(`@${agentName}`, `@${agentName}`);
    
    return (rows as any[]).map(r => ({
      roomId: r.room_id,
      roomName: r.room_name || 'Unknown',
      messageCount: r.message_count || 0,
      firstActivity: r.first_activity ? new Date(r.first_activity).getTime() : null,
      lastActivity: r.last_activity ? new Date(r.last_activity).getTime() : null,
      role: r.role as string,
      isCurrent: r.last_activity ? (Date.now() - new Date(r.last_activity).getTime()) < 7 * 24 * 60 * 60 * 1000 : false
    }));
  } catch {
    return [];
  }
}

function getTimeline(agentName: string, before?: number, after?: number, limit: number = 50): TimelineEntry[] {
  const sessions = getAgentSessions(agentName);
  if (sessions.length === 0) return [];
  
  const db = (queries as any).getDb?.() || null;
  if (!db) return [];
  
  try {
    const sessionIds = sessions.map(s => s.id);
    const placeholders = sessionIds.map(() => '?').join(',');
    
    let timeFilter = '';
    const params: any[] = [...sessionIds, limit];
    
    if (before) {
      timeFilter = 'AND ts_ms < ?';
      params.splice(params.length - 1, 0, before);
    }
    if (after) {
      timeFilter = 'AND ts_ms > ?';
      params.splice(params.length - 1, 0, after);
    }
    
    const rows = db.prepare(`
      SELECT 
        ts_ms as ts,
        kind as type,
        text as summary,
        session_id,
        payload
      FROM run_events 
      WHERE session_id IN (${placeholders}) ${timeFilter}
      ORDER BY ts_ms DESC
      LIMIT ?
    `).get(...params);
    
    return (rows as any[]).map(r => {
      let payload = {};
      try {
        payload = JSON.parse(r.payload || '{}');
      } catch {}
      
      return {
        ts: r.ts,
        type: mapEventType(r.type),
        summary: r.summary || '',
        sessionId: r.session_id,
        metadata: payload
      };
    });
  } catch {
    return [];
  }
}

function mapEventType(kind: string): TimelineEntry['type'] {
  const map: Record<string, TimelineEntry['type']> = {
    'command_block': 'file_edit',
    'tool_call': 'file_edit',
    'tool_result': 'file_edit',
    'permission': 'permission',
    'question': 'ask_posed',
    'answer': 'ask_answered',
    'progress': 'task_completed',
    'status': 'message'
  };
  return map[kind] || 'message';
}

export async function GET(event: RequestEvent<{ name: string }>) {
  assertNotRoomScoped(event);
  
  const { name } = event.params;
  const { searchParams } = event.url;
  const before = searchParams.has('before') ? Number(searchParams.get('before')) : undefined;
  const after = searchParams.has('after') ? Number(searchParams.get('after')) : undefined;
  const limit = Number(searchParams.get('limit') || 50);
  
  const timeline = getTimeline(name, before, after, Math.min(limit, 100));
  const historicalRooms = getHistoricalRooms(name);
  
  return json({
    timeline,
    historicalRooms,
    hasMore: timeline.length === limit
  });
}
