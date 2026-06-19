/**
 * GET /api/chat-rooms/:roomId/agent-statuses
 *
 * Lightweight per-agent status feed for the always-visible footer.
 * Joins chat_room_members → room_memberships → terminals.agent_status.
 * Returns one entry per agent member of the room. Members that have no
 * linked terminal still appear so the footer can render an unknown chip
 * (rather than silently dropping them).
 *
 * Task #115 — v3 footer parity. Read access is enforced centrally by
 * hooks.server.ts for room-scoped GET APIs before this handler runs.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { getIdentityDb } from '$lib/server/db';
import { projectEffectiveAgentStatus } from '$lib/server/effectiveAgentStatus';
import { hasResponseRequiredAsksForHandle } from '$lib/server/askStore';
import type { AgentStatus as StoredAgentStatus, AgentStatusSource } from '$lib/server/agentStatusStore';
import { listCliAgentsForRoom, type CliAgentHandle } from '$lib/server/cliAgentRegistry';
import { findStateForCwd, findStateForSessionId, type AgentCli } from '$lib/server/agentStateReader';
import { projectLiveAgentStateSnapshotToStatus } from '$lib/server/agentStateProjection';

type AgentStatus = StoredAgentStatus | 'unknown';

type StatusRow = {
  handle: string;
  agent_status: StoredAgentStatus | null;
  agent_status_source: AgentStatusSource | null;
  agent_status_at_ms: number | null;
  last_pty_byte_at_ms: number | null;
  /** terminals.created_at — unix seconds. Used to derive uptimeMs for
   *  the AgentContextChip pill (JWPK msg_dse7xti8fz). */
  created_at: number | null;
  /** Context-fill 0..1 from per-CLI fingerprint probe + when it was
   *  last written. Reader applies a 5-minute freshness policy. */
  agent_context_fill: number | null;
  agent_context_fill_at_ms: number | null;
  /** terminals.status (Phase A1 / 0.1.13). NULL when no terminal is
   *  bound to the membership (synthetic / unbound member). Surfaced
   *  so the participants pane can render an "archived" pill + Reclaim
   *  button (Phase C2). */
  lifecycle_status: 'live' | 'archived' | 'deleted' | null;
};

type StatusEntry = {
  handle: string;
  status: AgentStatus;
  statusSource: AgentStatusSource;
  crawlerMotion: 'moving' | 'resting';
  statusAtMs: number | null;
  openAsk: boolean;
  uptimeMs: number | null;
  contextFill: number | null;
  lifecycleStatus: 'live' | 'archived' | 'deleted' | null;
};

/** Stale-data window for context-fill. Probe should rewrite at least
 *  this often; anything older is treated as unknown so the chip doesn't
 *  show stuck percentages when an agent has exited or stalled. */
const CONTEXT_FILL_FRESH_WINDOW_MS = 5 * 60 * 1000;
const CRAWLER_MOVING_SOURCES = new Set<AgentStatusSource>([
  'fingerprint',
  'hook',
  'pane',
  'pid-cpu',
  'helper'
]);

function cliKindToStateCli(cli: CliAgentHandle['cli']): AgentCli {
  return cli === 'codex' ? 'codex-cli' : 'pi';
}

function displayHandleForCliAgent(
  agent: CliAgentHandle,
  duplicateIndex: number,
  reservedHandles: Set<string>
): string {
  const base = `@${agent.cli}`;
  let candidate = duplicateIndex === 0 ? base : `${base}-${duplicateIndex + 1}`;
  let suffix = duplicateIndex + 2;
  while (reservedHandles.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  reservedHandles.add(candidate);
  return candidate;
}

function statusEntryForCliAgent(
  agent: CliAgentHandle,
  duplicateIndex: number,
  reservedHandles: Set<string>
): StatusEntry {
  const cli = cliKindToStateCli(agent.cli);
  const sessionId = agent.getSessionId();
  const snapshot = sessionId ? findStateForSessionId(cli, sessionId) : null;
  const cwdSnapshot = snapshot ?? (agent.cwd ? findStateForCwd(cli, agent.cwd) : null);
  const projected = projectLiveAgentStateSnapshotToStatus(cwdSnapshot);
  return {
    handle: displayHandleForCliAgent(agent, duplicateIndex, reservedHandles),
    status: projected ?? 'unknown',
    statusSource: projected ? 'hook' : 'default',
    crawlerMotion: projected === 'working' || projected === 'thinking' || projected === 'response-required'
      ? 'moving'
      : 'resting',
    statusAtMs: cwdSnapshot ? Math.round(cwdSnapshot.mtimeMs) : null,
    openAsk: projected === 'response-required',
    uptimeMs:
      typeof agent.spawnedAtMs === 'number'
        ? Math.max(0, Date.now() - agent.spawnedAtMs)
        : null,
    contextFill: null,
    lifecycleStatus: null
  };
}

function crawlerMotionFor(
  effective: ReturnType<typeof projectEffectiveAgentStatus>,
  openAsk: boolean
): 'moving' | 'resting' {
  if (openAsk || effective.agent_status === 'response-required') return 'moving';
  if (effective.agent_status !== 'working' && effective.agent_status !== 'thinking') return 'resting';
  return CRAWLER_MOVING_SOURCES.has(effective.agent_status_source) ? 'moving' : 'resting';
}

export const GET: RequestHandler = ({ params }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) throw error(404, 'Room not found.');

  const agentHandles = room.members
    .filter((member) => member.kind === 'agent')
    .map((member) => member.handle);

  const roomCliAgents = listCliAgentsForRoom(params.roomId);

  let rows: StatusRow[] = [];
  if (agentHandles.length > 0) {
    const placeholders = agentHandles.map(() => '?').join(', ');
    rows = getIdentityDb()
      .prepare(
        `SELECT m.handle AS handle,
                t.agent_status AS agent_status,
                t.agent_status_source AS agent_status_source,
                t.agent_status_at_ms AS agent_status_at_ms,
                t.last_pty_byte_at_ms AS last_pty_byte_at_ms,
                t.created_at AS created_at,
                t.agent_context_fill AS agent_context_fill,
                t.agent_context_fill_at_ms AS agent_context_fill_at_ms,
                t.status AS lifecycle_status
           FROM room_memberships m
           LEFT JOIN terminals t ON t.id = m.terminal_id
          WHERE m.room_id = ? AND m.handle IN (${placeholders})`
      )
      .all(params.roomId, ...agentHandles) as StatusRow[];
  }

  const byHandle = new Map<string, StatusRow>();
  for (const row of rows) {
    const existing = byHandle.get(row.handle);
    const incomingAt = row.agent_status_at_ms ?? 0;
    const existingAt = existing?.agent_status_at_ms ?? -1;
    if (!existing || incomingAt >= existingAt) byHandle.set(row.handle, row);
  }

  const nowMs = Date.now();
  const statuses: StatusEntry[] = agentHandles.map((handle) => {
    const row = byHandle.get(handle);
    const effective = projectEffectiveAgentStatus(row);
    // uptimeMs = now - terminals.created_at (unix seconds). Powers the
    // AgentContextChip "14d · 47%" pill (JWPK msg_s6b6lzqzsv + msg_dse7xti8fz).
    // null when there's no terminal binding for the agent (synthetic
    // browser-session terminals + members-without-terminals).
    const uptimeMs =
      row && typeof row.created_at === 'number' && row.created_at > 0
        ? Math.max(0, nowMs - row.created_at * 1000)
        : null;
    // contextFill: read from terminals.agent_context_fill when fresh
    // (probe wrote within CONTEXT_FILL_FRESH_WINDOW_MS). Stale or
    // never-written values become null so the chip doesn't show a
    // stuck %. JWPK msg_vz19pvkajk 2026-05-19 — column shipped via
    // migration; per-CLI probes wire up incrementally (Claude first).
    let contextFill: number | null = null;
    if (
      row
      && typeof row.agent_context_fill === 'number'
      && typeof row.agent_context_fill_at_ms === 'number'
      && nowMs - row.agent_context_fill_at_ms <= CONTEXT_FILL_FRESH_WINDOW_MS
    ) {
      contextFill = row.agent_context_fill;
    }
    // Open-ask axis (three-axis model, 2026-06-01): "needs you" is ORTHOGONAL
    // to activity — an agent can be working AND awaiting input, or idle AND
    // awaiting input. Signal = the CLI reporting response-required (menuKind /
    // "Response needed") OR a persisted Ask targeted at this handle that is
    // still open. Surfaced as a SEPARATE field so the UI renders it as an
    // independent "needs you" badge, not a value on the activity pill. Additive
    // + non-breaking: `status` is unchanged for legacy readers. Confirmed-only
    // (never inferred from prose); resolves when the ask is answered-by-anyone
    // / superseded (askStore status leaves 'open').
    const openAsk =
      (row ? effective.agent_status === 'response-required' : false) ||
      hasResponseRequiredAsksForHandle(handle);
    return {
      handle,
      status: row ? effective.agent_status : 'unknown',
      statusSource: row ? effective.agent_status_source : 'default',
      crawlerMotion: row ? crawlerMotionFor(effective, openAsk) : 'resting',
      statusAtMs: row ? effective.agent_status_at_ms : null,
      openAsk,
      uptimeMs,
      contextFill,
      // Phase C2 (0.1.13): surface terminals.status so the participants
      // pane can render an archived treatment + Reclaim button. NULL when
      // there's no terminal bound (membership without terminal_id), so
      // readers should fold NULL into the same path as 'live'.
      lifecycleStatus: row?.lifecycle_status ?? null
    };
  });

  const cliCounts = new Map<CliAgentHandle['cli'], number>();
  const reservedHandles = new Set(agentHandles);
  for (const agent of roomCliAgents) {
    const index = cliCounts.get(agent.cli) ?? 0;
    cliCounts.set(agent.cli, index + 1);
    statuses.push(statusEntryForCliAgent(agent, index, reservedHandles));
  }

  return json({ statuses });
};
