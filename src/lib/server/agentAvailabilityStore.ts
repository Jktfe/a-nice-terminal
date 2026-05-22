/**
 * agentAvailabilityStore — fleet-wide "who is idle / focused / active" rollup
 * used by GET /api/agents/availability and `ant agents status`.
 *
 * JWPK directive (2026-05-20): "we should be able to get this info at the drop
 * of a hat". Today's path is 3 API calls + naming inference. This store joins
 * the existing tables once (no new schema) so any caller can ask "who is idle
 * and matches skill X" in a single fetch.
 *
 * Data sources (read-only):
 *   - chat_room_members  → handles + per-room joinedAt (kind='agent')
 *   - chat_rooms         → roomName + archived/deleted filters
 *   - chat_messages      → MAX(posted_at) per (handle, roomId) for lastActiveAt
 *   - tasks              → currently in_progress task assigned to the handle
 *   - focusModeStore     → in-memory per-(room, member) focus flag
 *
 * Skill + model inference are derived from the handle suffix. There is no
 * agent_registry.skills column today; if one is added later the inference can
 * be swapped out for a real lookup without changing the public shape.
 */

import { getIdentityDb } from './db';
import { findFocus } from './focusModeStore';

export type AgentAvailabilityRoom = {
  roomId: string;
  roomName: string;
  joinedAt: string;
  lastActiveAt: string | null;
  status: 'focused' | 'idle' | 'active';
};

export type AgentAvailabilityTask = {
  id: string;
  planId: string | null;
  title: string;
};

export type AgentAvailability = {
  handle: string;
  model: string;
  alive: boolean;
  currentRooms: AgentAvailabilityRoom[];
  currentTask: AgentAvailabilityTask | null;
  skills: string[];
};

export type AvailabilitySummary = {
  total: number;
  alive: number;
  inRoom: number;
  idle: number;
  focused: number;
};

export type AvailabilityFilters = {
  alive?: boolean;
  inRoom?: boolean;
  model?: string;
  skill?: string;
  roomId?: string;
};

// ACTIVE_WINDOW_MS — how recent posted_at must be for a room status of
// "active" (vs "idle"). Mirrors the 1h convention used by Chair digests.
const ACTIVE_WINDOW_MS = 60 * 60 * 1000;

// Model-name inference from handle text. Real handles in the fleet today
// look like `@evolveantclaude`, `@codexlead1`, `@codexollama4`, `@uxant` —
// suffixes aren't reliable (digit suffixes for sibling agents) so we
// substring-match the model token anywhere in the handle. Tokens are listed
// most-specific-first to avoid "ant" eating "@uxant" before "ux" gets a
// look-in. Each model carries a default skill set that callers can filter
// by until an explicit agent_registry.skills column lands.
const MODEL_TOKEN_MAP: Array<{ token: string; model: string; skills: string[] }> = [
  { token: 'claude', model: 'claude', skills: ['general'] },
  { token: 'codex', model: 'codex', skills: ['code-gen'] },
  { token: 'gemini', model: 'gemini', skills: ['general'] },
  { token: 'svelte', model: 'svelte', skills: ['svelte5', 'ui'] },
  { token: 'tauri', model: 'tauri', skills: ['tauri', 'windows'] },
  { token: 'swift', model: 'swift', skills: ['swift', 'macos'] },
  { token: 'kimi', model: 'kimi', skills: ['general'] },
  { token: 'qwen', model: 'qwen', skills: ['general'] },
  { token: 'deep', model: 'deep', skills: ['research'] },
  { token: 'glm', model: 'glm', skills: ['general'] },
  { token: 'ux', model: 'ux', skills: ['ux', 'design'] },
];

function inferModelAndSkills(handle: string): { model: string; skills: string[] } {
  const lower = handle.toLowerCase();
  for (const entry of MODEL_TOKEN_MAP) {
    if (lower.includes(entry.token)) {
      return { model: entry.model, skills: entry.skills };
    }
  }
  return { model: 'unknown', skills: [] };
}

type MemberRow = {
  handle: string;
  room_id: string;
  room_name: string;
  joined_at: string;
  room_archived_at_ms: number | null;
  room_deleted_at_ms: number | null;
};

type MessageRow = {
  handle: string;
  room_id: string;
  last_at: string;
};

type TaskRow = {
  handle: string;
  task_id: string;
  plan_id: string | null;
  title: string;
  subject: string;
};

function loadMembers(): MemberRow[] {
  // Pull EVERY agent membership — alive vs archived gets decided per-agent
  // by which rooms survive in currentRooms. Loading both lets `?alive=false`
  // surface handles whose only rooms are archived (audit / debug path).
  const db = getIdentityDb();
  return db
    .prepare(
      `SELECT crm.handle AS handle,
              crm.room_id AS room_id,
              cr.name AS room_name,
              crm.joined_at AS joined_at,
              cr.archived_at_ms AS room_archived_at_ms,
              cr.deleted_at_ms AS room_deleted_at_ms
       FROM chat_room_members crm
       JOIN chat_rooms cr ON cr.id = crm.room_id
       WHERE crm.kind = 'agent'
         AND crm.room_id NOT LIKE '__inbox_%'
       ORDER BY crm.handle ASC, crm.joined_at DESC`
    )
    .all() as MemberRow[];
}

function loadLastActiveByRoom(handles: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (handles.length === 0) return out;
  const db = getIdentityDb();
  const placeholders = handles.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT author_handle AS handle, room_id, MAX(posted_at) AS last_at
       FROM chat_messages
       WHERE author_handle IN (${placeholders})
         AND kind IN ('human','agent')
       GROUP BY author_handle, room_id`
    )
    .all(...handles) as MessageRow[];
  for (const row of rows) {
    out.set(`${row.handle}::${row.room_id}`, row.last_at);
  }
  return out;
}

function loadCurrentTasks(handles: string[]): Map<string, AgentAvailabilityTask> {
  const out = new Map<string, AgentAvailabilityTask>();
  if (handles.length === 0) return out;
  const db = getIdentityDb();
  const placeholders = handles.map(() => '?').join(',');
  // Match either the newer assigned_to or the legacy assigned_agent column —
  // tasksStore.ts treats both as equivalent. Most-recent in_progress wins so
  // callers see the agent's freshest claim if more than one is open.
  const rows = db
    .prepare(
      `SELECT COALESCE(assigned_to, assigned_agent) AS handle,
              id AS task_id,
              plan_id,
              COALESCE(title, subject) AS title,
              subject
       FROM tasks
       WHERE status = 'in_progress'
         AND (assigned_to IN (${placeholders}) OR assigned_agent IN (${placeholders}))
       ORDER BY updated_at_ms DESC`
    )
    .all(...handles, ...handles) as TaskRow[];
  for (const row of rows) {
    if (!row.handle || out.has(row.handle)) continue;
    out.set(row.handle, {
      id: row.task_id,
      planId: row.plan_id,
      title: row.title ?? row.subject ?? row.task_id,
    });
  }
  return out;
}

function deriveRoomStatus(
  roomId: string,
  handle: string,
  lastActiveAt: string | null,
  nowMs: number
): 'focused' | 'idle' | 'active' {
  if (findFocus(roomId, handle)) return 'focused';
  if (!lastActiveAt) return 'idle';
  const ts = Date.parse(lastActiveAt);
  if (Number.isNaN(ts)) return 'idle';
  return nowMs - ts <= ACTIVE_WINDOW_MS ? 'active' : 'idle';
}

function matchesFilters(agent: AgentAvailability, filters: AvailabilityFilters): boolean {
  if (filters.alive !== undefined && agent.alive !== filters.alive) return false;
  if (filters.model !== undefined && agent.model !== filters.model) return false;
  if (filters.skill !== undefined && !agent.skills.includes(filters.skill)) return false;
  if (filters.roomId !== undefined) {
    if (!agent.currentRooms.some((room) => room.roomId === filters.roomId)) return false;
  }
  if (filters.inRoom !== undefined) {
    const hasRoom = agent.currentRooms.length > 0;
    if (filters.inRoom !== hasRoom) return false;
  }
  return true;
}

export function listAgentAvailability(
  filters: AvailabilityFilters = {},
  nowMs: number = Date.now()
): { agents: AgentAvailability[]; summary: AvailabilitySummary } {
  const memberRows = loadMembers();

  // Group memberships by handle.
  const byHandle = new Map<string, MemberRow[]>();
  for (const row of memberRows) {
    const list = byHandle.get(row.handle) ?? [];
    list.push(row);
    byHandle.set(row.handle, list);
  }

  const handles = [...byHandle.keys()];
  const lastActiveByRoom = loadLastActiveByRoom(handles);
  const tasksByHandle = loadCurrentTasks(handles);

  const agents: AgentAvailability[] = [];
  for (const handle of handles) {
    const rows = byHandle.get(handle) ?? [];
    const { model, skills } = inferModelAndSkills(handle);
    // currentRooms = only the live (non-archived, non-deleted) rooms. We
    // still loaded archived rooms above so we can mark an agent alive=false
    // when its ONLY rooms are gone.
    const currentRooms: AgentAvailabilityRoom[] = rows
      .filter((row) => row.room_archived_at_ms === null && row.room_deleted_at_ms === null)
      .map((row) => {
        const lastActiveAt = lastActiveByRoom.get(`${handle}::${row.room_id}`) ?? null;
        return {
          roomId: row.room_id,
          roomName: row.room_name,
          joinedAt: row.joined_at,
          lastActiveAt,
          status: deriveRoomStatus(row.room_id, handle, lastActiveAt, nowMs),
        };
      });
    agents.push({
      handle,
      model,
      alive: currentRooms.length > 0,
      currentRooms,
      currentTask: tasksByHandle.get(handle) ?? null,
      skills,
    });
  }

  agents.sort((a, b) => a.handle.localeCompare(b.handle));

  const filtered = agents.filter((agent) => matchesFilters(agent, filters));

  const summary: AvailabilitySummary = {
    total: filtered.length,
    alive: filtered.filter((a) => a.alive).length,
    inRoom: filtered.filter((a) => a.currentRooms.length > 0).length,
    idle: filtered.filter(
      (a) => a.currentRooms.length === 0 || a.currentRooms.every((r) => r.status === 'idle')
    ).length,
    focused: filtered.filter((a) => a.currentRooms.some((r) => r.status === 'focused')).length,
  };

  return { agents: filtered, summary };
}
