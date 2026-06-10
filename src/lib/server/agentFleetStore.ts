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
import { getTelemetryDb, telemetrySidecarEnabled } from './telemetryDb';
import { listAgents, type AgentRegistryEntry, type AgentRoomMembership } from './agentRegistryStore';
import { listTerminalRecords, deriveHandle } from './terminalRecordsStore';
import { listTerminalModelsByIds } from './terminalsStore';
import { defaultParticipantColor, defaultParticipantIcon } from './chatRoomStore';
import { ALLOWED_REACTION_EMOJI } from '../reactions/canonicalEmoji';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SPARKLINE_HOURS = 24;
const HEATMAP_DAYS = 7;
// A terminal-less agent (active room seat, no attached local pty in
// terminal_records) is badged `remote` if it has been alive within this
// window, else `offline`. Liveness is a UNION of signals — recent chat OR a
// recent pty-byte / message heartbeat on a terminal its membership maps to —
// because an agent can be heads-down WORKING at a real pty for minutes
// without posting (the chat-only proxy mislabels that as offline). 15 min
// comfortably covers normal work gaps while still flagging genuine staleness.
// (The deeper cause that some agents have a live pty but no terminal_records
// row is the fresh-shell rebind gap; the binding fix is separate.)
const REMOTE_ACTIVE_MS = 15 * 60 * 1000;

// Positive reactions = the OK / Good / Celebrate buckets. 👎 is explicitly
// excluded and 🙋‍♂️ is a question, not approval.
const POSITIVE_EMOJIS = ALLOWED_REACTION_EMOJI.filter((e) => e === '👌' || e === '👍' || e === '🙌');

export type FleetAgent = {
  handle: string;
  // Terminal identity — the fleet is TERMINAL-centric (one card per attached,
  // non-archived terminal), so these distinguish terminals that share or lack
  // a handle. `handle` falls back to the derived handle for handle-less rows.
  sessionId: string;
  name: string;
  agentKind: string | null;
  model: string | null;
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
  const idDb = getIdentityDb();
  const handlePlaceholders = handles.map(() => '?').join(',');
  // 1. handle → its terminal session_ids (identity DB owns terminal_records).
  const trRows = idDb
    .prepare(
      `SELECT handle, session_id FROM terminal_records WHERE handle IN (${handlePlaceholders})`
    )
    .all(...handles) as Array<{ handle: string; session_id: string }>;
  if (trRows.length === 0) return out;
  const sessionToHandle = new Map<string, string>();
  for (const r of trRows) sessionToHandle.set(r.session_id, r.handle);
  const sessionIds = [...sessionToHandle.keys()];

  // 2. Latest non-deleted run events for those terminals. terminal_run_events
  //    may now live in the telemetry sidecar, so this is a separate query
  //    (no cross-file JOIN) unioned across telemetry + identity and merged
  //    newest-first — replacing the old `JOIN terminal_run_events` query.
  const sidPlaceholders = sessionIds.map(() => '?').join(',');
  const evSql = `SELECT terminal_id, payload, ts_ms FROM terminal_run_events
       WHERE terminal_id IN (${sidPlaceholders}) AND deleted_at_ms IS NULL
       ORDER BY ts_ms DESC`;
  const readDbs = telemetrySidecarEnabled() ? [getTelemetryDb(), idDb] : [idDb];
  const evRows = readDbs
    .flatMap(
      (db) =>
        db.prepare(evSql).all(...sessionIds) as Array<{
          terminal_id: string;
          payload: string;
          ts_ms: number;
        }>
    )
    .sort((a, b) => b.ts_ms - a.ts_ms);

  // 3. JS join: the latest event WITH a cwd per handle wins (matches the old
  //    behaviour — out.has(handle) only becomes true once a cwd is set, so a
  //    newer cwd-less event doesn't block an older one with a cwd).
  for (const row of evRows) {
    const handle = sessionToHandle.get(row.terminal_id);
    if (!handle || out.has(handle)) continue;
    try {
      const parsed = JSON.parse(row.payload ?? '{}');
      if (typeof parsed?.cwd === 'string' && parsed.cwd.length > 0) {
        out.set(handle, parsed.cwd);
      }
    } catch {
      // ignore malformed payload
    }
  }
  return out;
}

// Latest chat-message timestamp (ms) per handle — drives the remote/offline
// badge for terminal-less agents, which have no pty heartbeat to read.
function loadLastMessageAtByHandle(handles: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (handles.length === 0) return out;
  const db = getIdentityDb();
  const placeholders = handles.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT author_handle AS handle, MAX(posted_at) AS last_at
       FROM chat_messages
       WHERE author_handle IN (${placeholders})
         AND kind IN ('human','agent')
       GROUP BY author_handle`
    )
    .all(...handles) as Array<{ handle: string; last_at: string | null }>;
  for (const r of rows) {
    if (!r.last_at) continue;
    const ms = Date.parse(r.last_at);
    if (!Number.isNaN(ms)) out.set(r.handle, ms);
  }
  return out;
}

// Latest pty/message heartbeat (ms) per handle, via the terminal(s) the
// handle's active memberships map to. Complements chat recency for agents
// that work silently at a real pty without posting. Revoked seats are
// excluded so a dead seat's stale terminal can't keep an agent "alive".
function loadHeartbeatByHandle(handles: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (handles.length === 0) return out;
  const db = getIdentityDb();
  const placeholders = handles.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT rm.handle AS handle,
              MAX(MAX(COALESCE(t.last_pty_byte_at_ms, 0), COALESCE(t.last_message_sent_at_ms, 0))) AS hb
         FROM room_memberships rm
         JOIN terminals t ON t.id = rm.terminal_id
        WHERE rm.handle IN (${placeholders})
          AND rm.revoked_at_ms IS NULL
        GROUP BY rm.handle`
    )
    .all(...handles) as Array<{ handle: string; hb: number | null }>;
  for (const r of rows) {
    if (r.hb && r.hb > 0) out.set(r.handle, r.hb);
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

// "Live and attached" — JWPK msg_g127w99mxe: pane_status='verified' alone
// isn't enough because nobody updates the column when a tmux session is
// killed externally; rows stay 'verified' long after the pane is gone. The
// authoritative liveness signal is the current tmux session set (what /api
// /terminals already uses for its `alive` flag). The caller passes the set
// of live tmux session ids; we intersect with room_memberships → terminals
// to keep only handles whose terminal is BOTH bound to an existing tmux pane
// AND not TTL-expired.
//
// We also lift terminals.agent_status here so /agents can render the
// current working/thinking/idle/response-required state (JWPK msg_7vpz9qyahp:
// "Why does it say 0 active now when I can see agents working"). When an
// agent has multiple live terminals (e.g. registered into multiple rooms),
// the most-recent agent_status_at_ms wins.
type HandleStatus = { state: string; atMs: number };
function listLiveAttachedHandles(
  nowMs: number,
  liveSessionIds: ReadonlySet<string>
): Map<string, HandleStatus> {
  if (liveSessionIds.size === 0) return new Map();
  const db = getIdentityDb();
  const nowSeconds = Math.floor(nowMs / 1000);
  const placeholders = [...liveSessionIds].map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT rm.handle AS handle, t.agent_status AS state, t.agent_status_at_ms AS at_ms
       FROM room_memberships rm
       JOIN terminals t ON t.id = rm.terminal_id
       WHERE rm.terminal_id IN (${placeholders})
         AND (t.expires_at IS NULL OR t.expires_at > ?)`
    )
    .all(...liveSessionIds, nowSeconds) as Array<{ handle: string; state: string; at_ms: number }>;

  const out = new Map<string, HandleStatus>();
  for (const row of rows) {
    const prev = out.get(row.handle);
    if (!prev || row.at_ms > prev.atMs) {
      out.set(row.handle, { state: row.state, atMs: row.at_ms });
    }
  }
  return out;
}

// Per-terminal runtime (agent_status + TTL), keyed by terminal session id —
// the terminal-centric analogue of listLiveAttachedHandles (which keys by
// handle via room_memberships and so can't see handle-less terminals). We lift
// expires_at here too so TTL-expired terminals are dropped even when tmux still
// claims the pane.
type TerminalRuntime = { state: string | null; atMs: number; expiresAt: number | null };
function loadTerminalRuntime(sessionIds: string[]): Map<string, TerminalRuntime> {
  const out = new Map<string, TerminalRuntime>();
  if (sessionIds.length === 0) return out;
  const db = getIdentityDb();
  const placeholders = sessionIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, agent_status AS state, agent_status_at_ms AS at_ms, expires_at
       FROM terminals WHERE id IN (${placeholders})`
    )
    .all(...sessionIds) as Array<{ id: string; state: string | null; at_ms: number | null; expires_at: number | null }>;
  for (const r of rows) {
    out.set(r.id, { state: r.state, atMs: r.at_ms ?? 0, expiresAt: r.expires_at });
  }
  return out;
}

// TERMINAL-centric fleet (JWPK 2026-06-01): show EVERY attached, non-archived
// terminal — not just registry agents with a live LOCAL pty, which was an
// inner-join that hid remote + handle-less terminals (7-of-2 / 18-of-2 bug).
// Inclusion = pane-bound (attached) + not superseded + alive (live session).
// Excludes unattached (no pane / browser-bs) + archived (pane gone / superseded).
// Each terminal is badged with its live agent_status. Stats/rooms are layered
// in by handle where the terminal's handle is a registered agent; handle-less
// terminals still appear (with a derived handle + zeroed stats).
export function listFleetAgents(
  liveSessionIds: ReadonlySet<string>,
  nowMs: number = Date.now()
): FleetAgent[] {
  const nowSeconds = Math.floor(nowMs / 1000);
  const candidates = listTerminalRecords().filter(
    (r) =>
      r.tmux_target_pane !== null &&
      r.superseded_at_ms === null &&
      liveSessionIds.has(r.session_id)
  );
  const runtime = loadTerminalRuntime(candidates.map((r) => r.session_id));
  // Drop TTL-expired terminals (tmux may still claim the pane, but the binding
  // has lapsed) — matches the old listLiveAttachedHandles expiry guard.
  const records = candidates.filter((r) => {
    const rt = runtime.get(r.session_id);
    return !rt || rt.expiresAt === null || rt.expiresAt > nowSeconds;
  });

  const registry = listAgents();
  const registryByHandle = new Map(registry.map((a) => [a.handle, a] as const));
  const collabByHandle = loadCollaborators(registry);
  const modelById = listTerminalModelsByIds(records.map((r) => r.session_id));
  const terminalHandles = new Set(records.map((r) => r.handle ?? deriveHandle(r)));

  // UNION — registered agents that hold an ACTIVE room seat but have NO
  // attached terminal on this host. JWPK 2026-06-01: "@v4claude isn't on the
  // agents page" — an agent JWPK was actively talking to was dropped because
  // the fleet is terminal_records-sourced and that agent has an identity +
  // membership but no local terminal row (fresh-shell rebind gap / remote
  // agent). These surface as terminal-less cards badged remote (recent chat
  // activity) or offline. The flip side of the original "only-2" bug, where
  // the filter was so narrow it hid terminals; this restores agents the
  // terminal-centric query structurally cannot see.
  const terminalLessAgents = registry.filter(
    (a) => a.rooms.length > 0 && !terminalHandles.has(a.handle)
  );

  const handles = [
    ...new Set([...terminalHandles, ...terminalLessAgents.map((a) => a.handle)]),
  ];
  const counts = aggregateCounts(handles, nowMs);
  const series = timeseriesByHandle(handles, nowMs);
  const workspaces = loadHandleWorkspaces(handles);
  const terminalLessHandles = terminalLessAgents.map((a) => a.handle);
  const lastMessageAt = loadLastMessageAtByHandle(terminalLessHandles);
  const heartbeatAt = loadHeartbeatByHandle(terminalLessHandles);

  const terminalEntries: FleetAgent[] = records.map((r) => {
    const handle = r.handle ?? deriveHandle(r);
    const reg = registryByHandle.get(handle);
    // Prefer the registered agent's display name; fall back to the terminal
    // name (handle-less terminals like `fast`/`antc4`).
    const displayName = reg?.displayName ?? (r.name || handle);
    const c = counts.get(handle) ?? emptyCounts();
    const s = series.get(handle) ?? {
      sparkline: new Array(SPARKLINE_HOURS).fill(0),
      heatmap: new Array(HEATMAP_DAYS).fill(0),
    };
    // Live terminal → its agent_status (default idle); never null here since
    // every record in this list is alive + non-expired.
    const rt = runtime.get(r.session_id);
    return {
      handle,
      sessionId: r.session_id,
      name: r.name,
      agentKind: r.agent_kind,
      model: modelById.get(r.session_id) ?? null,
      displayName,
      displayColor: reg?.displayColor ?? defaultParticipantColor(handle),
      displayIcon: reg?.displayIcon ?? defaultParticipantIcon(displayName),
      displayBackgroundStyle: reg?.displayBackgroundStyle ?? null,
      rooms: reg?.rooms ?? [],
      pastRooms: [],
      collaborators: collabByHandle.get(handle) ?? [],
      status: rt?.state ? { state: rt.state, atMs: rt.atMs } : { state: 'idle', atMs: nowMs },
      workspace: workspaces.get(handle) ?? null,
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

  // Terminal-less active agents — no local pty, so no sessionId, agentKind or
  // model, and the /agents card hides the go-to-terminal nav for an empty
  // sessionId. Status is derived from recent chat activity (remote/offline)
  // since there is no pty heartbeat. Stats/rooms still layer in by handle.
  const terminalLessEntries: FleetAgent[] = terminalLessAgents.map((a) => {
    const handle = a.handle;
    const c = counts.get(handle) ?? emptyCounts();
    const s = series.get(handle) ?? {
      sparkline: new Array(SPARKLINE_HOURS).fill(0),
      heatmap: new Array(HEATMAP_DAYS).fill(0),
    };
    // Liveness = the most recent of chat activity OR pty/message heartbeat,
    // so an agent working silently at a real pty still reads alive.
    const lastChatAt = lastMessageAt.get(handle) ?? 0;
    const lastBeatAt = heartbeatAt.get(handle) ?? 0;
    const lastAt = Math.max(lastChatAt, lastBeatAt) || null;
    const isRemote = lastAt !== null && nowMs - lastAt <= REMOTE_ACTIVE_MS;
    return {
      handle,
      sessionId: '',
      name: a.displayName,
      agentKind: null,
      model: null,
      displayName: a.displayName,
      displayColor: a.displayColor ?? defaultParticipantColor(handle),
      displayIcon: a.displayIcon ?? defaultParticipantIcon(a.displayName),
      displayBackgroundStyle: a.displayBackgroundStyle ?? null,
      rooms: a.rooms,
      pastRooms: [],
      collaborators: collabByHandle.get(handle) ?? [],
      status: { state: isRemote ? 'remote' : 'offline', atMs: lastAt ?? nowMs },
      workspace: workspaces.get(handle) ?? null,
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

  return [...terminalEntries, ...terminalLessEntries];
}
