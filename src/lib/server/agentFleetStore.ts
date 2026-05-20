/**
 * agentFleetStore — rich per-agent aggregation used by GET /api/agents?view=fleet
 * and consumed by /agents (the JWPK fleet dashboard).
 *
 * The bare agentRegistryStore returns identity + room memberships; this
 * module layers on activity stats (messages / reactions / tasks / asks /
 * plans / run events), per-handle status/workspace, sparkline + heatmap
 * timeseries, and collaborator lists. All queries hit the shared identity DB
 * directly so we avoid in-memory store fan-out and N+1 patterns.
 */

import { getIdentityDb } from './db';
import { listAgents, type AgentRegistryEntry, type AgentRoomMembership } from './agentRegistryStore';
import { ALLOWED_REACTION_EMOJI } from '../reactions/canonicalEmoji';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SPARKLINE_HOURS = 24;
const HEATMAP_DAYS = 7;

// Positive reactions = the OK / Good / Celebrate buckets. 👎 is explicitly
// excluded and 🙋‍♂️ is a question, not approval.
const POSITIVE_EMOJIS = ALLOWED_REACTION_EMOJI.filter((e) => e === '👌' || e === '👍' || e === '🙌');

export type FleetAgent = {
  handle: string;
  displayName: string;
  displayColor: string | null;
  displayIcon: string | null;
  displayBackgroundStyle: string | null;
  rooms: AgentRoomMembership[];
  pastRooms: Array<{ roomId: string; roomName: string }>;
  collaborators: string[];
  status: { state: string | null; atMs: number | null } | null;
  workspace: string | null;
  productivityScore: number;
  deliveryRate: number;
  streakDays: number;
  sparkline: number[];
  heatmap: number[];
  stats: {
    messages24h: number;
    runEvents24h: number;
    plansCreated: number;
    positiveReactions: number;
    tasks: { completed: number; inProgress: number; pending: number; blocked: number };
    asksPosed: { open: number };
  };
};

type Counts = {
  messages24h: number;
  positiveReactions: number;
  plansCreated: number;
  tasks: { completed: number; inProgress: number; pending: number; blocked: number };
  asksOpen: number;
  runEvents24h: number;
};

function emptyCounts(): Counts {
  return {
    messages24h: 0,
    positiveReactions: 0,
    plansCreated: 0,
    tasks: { completed: 0, inProgress: 0, pending: 0, blocked: 0 },
    asksOpen: 0,
    runEvents24h: 0,
  };
}

function aggregateCounts(handles: string[], nowMs: number): Map<string, Counts> {
  const out = new Map<string, Counts>();
  for (const h of handles) out.set(h, emptyCounts());
  if (handles.length === 0) return out;

  const db = getIdentityDb();
  const placeholders = handles.map(() => '?').join(',');
  const since24h = nowMs - DAY_MS;
  const sinceIso = new Date(since24h).toISOString();

  // messages24h — chat_messages.posted_at is ISO text.
  const msgRows = db
    .prepare(
      `SELECT author_handle AS handle, COUNT(*) AS n
       FROM chat_messages
       WHERE author_handle IN (${placeholders})
         AND posted_at >= ?
         AND kind IN ('human','agent')
       GROUP BY author_handle`
    )
    .all(...handles, sinceIso) as Array<{ handle: string; n: number }>;
  for (const r of msgRows) {
    const c = out.get(r.handle);
    if (c) c.messages24h = r.n;
  }

  // positiveReactions — reactions on this handle's messages, positive-only.
  if (POSITIVE_EMOJIS.length > 0) {
    const emojiPlaceholders = POSITIVE_EMOJIS.map(() => '?').join(',');
    const reactRows = db
      .prepare(
        `SELECT cm.author_handle AS handle, COUNT(*) AS n
         FROM message_reactions mr
         JOIN chat_messages cm ON cm.id = mr.message_id
         WHERE cm.author_handle IN (${placeholders})
           AND mr.emoji IN (${emojiPlaceholders})
         GROUP BY cm.author_handle`
      )
      .all(...handles, ...POSITIVE_EMOJIS) as Array<{ handle: string; n: number }>;
    for (const r of reactRows) {
      const c = out.get(r.handle);
      if (c) c.positiveReactions = r.n;
    }
  }

  // plansCreated.
  const planRows = db
    .prepare(
      `SELECT created_by AS handle, COUNT(*) AS n
       FROM plans
       WHERE created_by IN (${placeholders})
         AND deleted_at_ms IS NULL
       GROUP BY created_by`
    )
    .all(...handles) as Array<{ handle: string; n: number }>;
  for (const r of planRows) {
    const c = out.get(r.handle);
    if (c) c.plansCreated = r.n;
  }

  // tasks by status.
  const taskRows = db
    .prepare(
      `SELECT assigned_agent AS handle, status, COUNT(*) AS n
       FROM tasks
       WHERE assigned_agent IN (${placeholders})
         AND status != 'deleted'
       GROUP BY assigned_agent, status`
    )
    .all(...handles) as Array<{ handle: string; status: string; n: number }>;
  for (const r of taskRows) {
    const c = out.get(r.handle);
    if (!c) continue;
    if (r.status === 'completed') c.tasks.completed = r.n;
    else if (r.status === 'in_progress') c.tasks.inProgress = r.n;
    else if (r.status === 'pending') c.tasks.pending = r.n;
    else if (r.status === 'blocked') c.tasks.blocked = r.n;
  }

  // asks open.
  const askRows = db
    .prepare(
      `SELECT opened_by_handle AS handle, COUNT(*) AS n
       FROM asks
       WHERE opened_by_handle IN (${placeholders})
         AND status = 'open'
       GROUP BY opened_by_handle`
    )
    .all(...handles) as Array<{ handle: string; n: number }>;
  for (const r of askRows) {
    const c = out.get(r.handle);
    if (c) c.asksOpen = r.n;
  }

  // runEvents24h — join terminal_records.handle → terminal_run_events.terminal_id
  // (which is the terminal_records.session_id for daemon-spawned sessions).
  const runRows = db
    .prepare(
      `SELECT tr.handle AS handle, COUNT(*) AS n
       FROM terminal_run_events tre
       JOIN terminal_records tr ON tr.session_id = tre.terminal_id
       WHERE tr.handle IN (${placeholders})
         AND tre.ts_ms >= ?
         AND tre.deleted_at_ms IS NULL
       GROUP BY tr.handle`
    )
    .all(...handles, since24h) as Array<{ handle: string; n: number }>;
  for (const r of runRows) {
    const c = out.get(r.handle);
    if (c) c.runEvents24h = r.n;
  }

  return out;
}

function timeseriesByHandle(handles: string[], nowMs: number): Map<string, { sparkline: number[]; heatmap: number[] }> {
  const out = new Map<string, { sparkline: number[]; heatmap: number[] }>();
  for (const h of handles) {
    out.set(h, {
      sparkline: new Array(SPARKLINE_HOURS).fill(0),
      heatmap: new Array(HEATMAP_DAYS).fill(0),
    });
  }
  if (handles.length === 0) return out;

  const db = getIdentityDb();
  const placeholders = handles.map(() => '?').join(',');
  const sparklineSince = nowMs - SPARKLINE_HOURS * HOUR_MS;
  const heatmapSince = nowMs - HEATMAP_DAYS * DAY_MS;
  const earliest = Math.min(sparklineSince, heatmapSince);
  const earliestIso = new Date(earliest).toISOString();

  const rows = db
    .prepare(
      `SELECT author_handle AS handle, posted_at
       FROM chat_messages
       WHERE author_handle IN (${placeholders})
         AND posted_at >= ?
         AND kind IN ('human','agent')`
    )
    .all(...handles, earliestIso) as Array<{ handle: string; posted_at: string }>;

  for (const row of rows) {
    const ts = Date.parse(row.posted_at);
    if (Number.isNaN(ts)) continue;
    const entry = out.get(row.handle);
    if (!entry) continue;

    // sparkline — 24 buckets, index 0 = (now - 24h), index 23 = (now - 1h).
    if (ts >= sparklineSince) {
      const bucket = Math.min(SPARKLINE_HOURS - 1, Math.floor((ts - sparklineSince) / HOUR_MS));
      entry.sparkline[bucket] = (entry.sparkline[bucket] ?? 0) + 1;
    }

    // heatmap — 7 daily buckets indexed by Sun..Sat (matches dayLabels in
    // +page.svelte).
    if (ts >= heatmapSince) {
      const day = new Date(ts).getDay();
      entry.heatmap[day] = (entry.heatmap[day] ?? 0) + 1;
    }
  }

  return out;
}

function loadHandleWorkspaces(handles: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (handles.length === 0) return out;
  const db = getIdentityDb();
  const placeholders = handles.map(() => '?').join(',');
  // Latest run event per handle's terminals gives the most recent cwd.
  const rows = db
    .prepare(
      `SELECT tr.handle AS handle, tre.payload AS payload
       FROM terminal_records tr
       JOIN terminal_run_events tre ON tre.terminal_id = tr.session_id
       WHERE tr.handle IN (${placeholders})
         AND tre.deleted_at_ms IS NULL
       ORDER BY tre.ts_ms DESC`
    )
    .all(...handles) as Array<{ handle: string; payload: string }>;
  for (const row of rows) {
    if (out.has(row.handle)) continue;
    try {
      const parsed = JSON.parse(row.payload ?? '{}');
      if (typeof parsed?.cwd === 'string' && parsed.cwd.length > 0) {
        out.set(row.handle, parsed.cwd);
      }
    } catch {
      // ignore malformed payload
    }
  }
  return out;
}

function loadCollaborators(agents: AgentRegistryEntry[]): Map<string, string[]> {
  // For every agent, list the OTHER agent handles that share a current room.
  const out = new Map<string, string[]>();
  const handleToRooms = new Map<string, Set<string>>();
  for (const a of agents) {
    handleToRooms.set(a.handle, new Set(a.rooms.map((r) => r.roomId)));
  }
  for (const a of agents) {
    const myRooms = handleToRooms.get(a.handle)!;
    const collabs = new Set<string>();
    for (const other of agents) {
      if (other.handle === a.handle) continue;
      const otherRooms = handleToRooms.get(other.handle)!;
      for (const r of otherRooms) {
        if (myRooms.has(r)) {
          collabs.add(other.handle);
          break;
        }
      }
    }
    out.set(a.handle, [...collabs].sort());
  }
  return out;
}

function computeProductivityScore(c: Counts): number {
  return c.messages24h + c.tasks.completed * 5 + c.plansCreated * 3 + c.positiveReactions * 2;
}

function computeDeliveryRate(c: Counts): number {
  const denom = c.tasks.completed + c.tasks.inProgress + c.tasks.pending + c.tasks.blocked;
  if (denom === 0) return 0;
  return Math.round((c.tasks.completed / denom) * 100);
}

function computeStreakDays(heatmap: number[]): number {
  // heatmap is Sun..Sat. Compute consecutive active days ending today.
  const todayIdx = new Date().getDay();
  let streak = 0;
  for (let i = 0; i < HEATMAP_DAYS; i++) {
    const idx = (todayIdx - i + HEATMAP_DAYS) % HEATMAP_DAYS;
    if ((heatmap[idx] ?? 0) > 0) streak++;
    else break;
  }
  return streak;
}

// "Live and attached" — a handle is in this set if it owns at least one
// room_memberships row whose joined `terminals` row is pane_status='verified'
// AND not expired. Stale / unknown panes, missing terminals, and TTL-expired
// rows are excluded; JWPK msg_1kd1y30gqs: "should only be the live and
// attached ones". `terminals.expires_at` is unix seconds (see
// terminalsStore.sweepExpiredTerminals).
function listLiveAttachedHandles(nowMs: number): Set<string> {
  const db = getIdentityDb();
  const nowSeconds = Math.floor(nowMs / 1000);
  const rows = db
    .prepare(
      `SELECT DISTINCT rm.handle AS handle
       FROM room_memberships rm
       JOIN terminals t ON t.id = rm.terminal_id
       WHERE t.pane_status = 'verified'
         AND (t.expires_at IS NULL OR t.expires_at > ?)`
    )
    .all(nowSeconds) as Array<{ handle: string }>;
  return new Set(rows.map((r) => r.handle));
}

export function listFleetAgents(nowMs: number = Date.now()): FleetAgent[] {
  const liveHandles = listLiveAttachedHandles(nowMs);
  const agents = listAgents().filter((a) => liveHandles.has(a.handle));
  const handles = agents.map((a) => a.handle);

  const counts = aggregateCounts(handles, nowMs);
  const series = timeseriesByHandle(handles, nowMs);
  const workspaces = loadHandleWorkspaces(handles);
  const collaborators = loadCollaborators(agents);

  return agents.map((a) => {
    const c = counts.get(a.handle) ?? emptyCounts();
    const s = series.get(a.handle) ?? {
      sparkline: new Array(SPARKLINE_HOURS).fill(0),
      heatmap: new Array(HEATMAP_DAYS).fill(0),
    };
    return {
      handle: a.handle,
      displayName: a.displayName,
      displayColor: a.displayColor,
      displayIcon: a.displayIcon,
      displayBackgroundStyle: a.displayBackgroundStyle,
      rooms: a.rooms,
      pastRooms: [],
      collaborators: collaborators.get(a.handle) ?? [],
      status: null,
      workspace: workspaces.get(a.handle) ?? null,
      productivityScore: computeProductivityScore(c),
      deliveryRate: computeDeliveryRate(c),
      streakDays: computeStreakDays(s.heatmap),
      sparkline: s.sparkline,
      heatmap: s.heatmap,
      stats: {
        messages24h: c.messages24h,
        runEvents24h: c.runEvents24h,
        plansCreated: c.plansCreated,
        positiveReactions: c.positiveReactions,
        tasks: c.tasks,
        asksPosed: { open: c.asksOpen },
      },
    };
  });
}
