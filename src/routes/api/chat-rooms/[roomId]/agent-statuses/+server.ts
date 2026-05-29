/**
 * GET /api/chat-rooms/:roomId/agent-statuses
 *
 * Lightweight per-agent status feed for the always-visible footer.
 * Joins chat_room_members → room_memberships → terminals.agent_status.
 * Returns one entry per agent member of the room. Members that have no
 * linked terminal still appear so the footer can render an unknown chip
 * (rather than silently dropping them).
 *
 * Task #115 — v3 footer parity. Read-only, no auth gate beyond room
 * existence (matches digest/file-refs/artefacts patterns).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { getIdentityDb } from '$lib/server/db';
import { projectEffectiveAgentStatus } from '$lib/server/effectiveAgentStatus';
import type { AgentStatus as StoredAgentStatus, AgentStatusSource } from '$lib/server/agentStatusStore';

type AgentStatus = StoredAgentStatus | 'unknown';

type StatusRow = {
  handle: string;
  agent_status: StoredAgentStatus | null;
  agent_status_source: AgentStatusSource | null;
  agent_status_at_ms: number | null;
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

/** Stale-data window for context-fill. Probe should rewrite at least
 *  this often; anything older is treated as unknown so the chip doesn't
 *  show stuck percentages when an agent has exited or stalled. */
const CONTEXT_FILL_FRESH_WINDOW_MS = 5 * 60 * 1000;

export const GET: RequestHandler = ({ params }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) throw error(404, 'Room not found.');

  const agentHandles = room.members
    .filter((member) => member.kind === 'agent')
    .map((member) => member.handle);

  if (agentHandles.length === 0) {
    return json({ statuses: [] });
  }

  const placeholders = agentHandles.map(() => '?').join(', ');
  const rows = getIdentityDb()
    .prepare(
      `SELECT m.handle AS handle,
              t.agent_status AS agent_status,
              t.agent_status_source AS agent_status_source,
              t.agent_status_at_ms AS agent_status_at_ms,
              t.created_at AS created_at,
              t.agent_context_fill AS agent_context_fill,
              t.agent_context_fill_at_ms AS agent_context_fill_at_ms,
              t.status AS lifecycle_status
         FROM room_memberships m
         LEFT JOIN terminals t ON t.id = m.terminal_id
        WHERE m.room_id = ? AND m.handle IN (${placeholders})`
    )
    .all(params.roomId, ...agentHandles) as StatusRow[];

  const byHandle = new Map<string, StatusRow>();
  for (const row of rows) {
    const existing = byHandle.get(row.handle);
    const incomingAt = row.agent_status_at_ms ?? 0;
    const existingAt = existing?.agent_status_at_ms ?? -1;
    if (!existing || incomingAt >= existingAt) byHandle.set(row.handle, row);
  }

  const nowMs = Date.now();
  const statuses = agentHandles.map((handle) => {
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
    return {
      handle,
      status: row ? effective.agent_status : 'unknown',
      statusAtMs: row ? effective.agent_status_at_ms : null,
      uptimeMs,
      contextFill,
      // Phase C2 (0.1.13): surface terminals.status so the participants
      // pane can render an archived treatment + Reclaim button. NULL when
      // there's no terminal bound (membership without terminal_id), so
      // readers should fold NULL into the same path as 'live'.
      lifecycleStatus: row?.lifecycle_status ?? null
    };
  });

  return json({ statuses });
};
