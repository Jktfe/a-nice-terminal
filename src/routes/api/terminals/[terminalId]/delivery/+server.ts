/**
 * Per-terminal delivery state surface (M3.5a).
 *
 *   GET  /api/terminals/:terminalId/delivery
 *     → 200 { terminal_id, name, agent_kind, delivery_state,
 *             pane_status, pane_stale_since, reason, updated_at }
 *     → 404 if the terminal is not registered.
 *
 * Surfaces existing terminals.pane_status as a user-facing delivery_state
 * (verified / stale / unknown) with a plain-English reason. v1 surface —
 * rich agent status (working/idle/thinking/response-required) is M3.4a-v2.
 *
 * Read-only — no pidChain required.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';
import { getTerminalById } from '$lib/server/terminalsStore';

export const GET: RequestHandler = async ({ params, request }) => {
  requireOperatorLikeAuth(request);
  const terminal = getTerminalById(params.terminalId);
  if (!terminal) {
    throw error(404, 'Terminal not found.');
  }
  const { delivery_state, reason } = classifyDelivery(terminal.pane_status, terminal.pane_stale_since);
  return json({
    terminal_id: terminal.id,
    name: terminal.name,
    agent_kind: terminal.agent_kind,
    delivery_state,
    pane_status: terminal.pane_status,
    pane_stale_since: terminal.pane_stale_since,
    reason,
    updated_at: terminal.updated_at
  });
};

function classifyDelivery(
  paneStatus: 'verified' | 'unknown' | 'stale',
  paneStaleSince: number | null
): { delivery_state: 'verified' | 'stale' | 'unknown'; reason: string } {
  if (paneStatus === 'verified') {
    return {
      delivery_state: 'verified',
      reason: 'Pane verified at ready prompt.'
    };
  }
  if (paneStatus === 'stale') {
    return {
      delivery_state: 'stale',
      reason: paneStaleSince !== null
        ? `Stopped responding at unix ${paneStaleSince}.`
        : 'Stopped responding.'
    };
  }
  return {
    delivery_state: 'unknown',
    reason: 'Registered but not yet observed at a ready prompt.'
  };
}
