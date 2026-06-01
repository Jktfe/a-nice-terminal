/**
 * /api/cli-hook — CLI-HOOK-BRIDGE Phase 1A receiver endpoint
 * (2026-05-15, JWPK Slice B follow-up).
 *
 * Consumes structured agent-lifecycle events from CLI hook installations.
 * The primary client today is Claude Code (≥2.1.141) configured to POST
 * its hook stdin JSON to this URL via a `command` hook in settings.json.
 * Future phases extend the receiver to codex/pi/gemini using each CLI's
 * native observability surface (Codex app-server / Pi --mode rpc /
 * Gemini OTel). All four CLIs persist to the same `cli_hook_events` table
 * (see cliHookEventsStore.ts).
 *
 * Security shape (SPAWN-LOCALITY-GATE parity, 2026-05-15):
 * - `Authorization: Bearer rbt_*` is REJECTED (remote-bridge bearers
 *   must not push hook events; hooks are inherently local).
 * - No positive auth requirement for v1 — CLI hook scripts call this
 *   endpoint without any auth header. The endpoint is intended to be
 *   loopback-reachable only; firewalling is a later concern.
 *
 * Endpoint contract:
 *   POST /api/cli-hook?source=<cli>
 *     Body: any JSON object. Required fields:
 *       - session_id      (string, non-blank)
 *       - hook_event_name (string, non-blank)
 *     Optional promoted fields (extracted into columns when present):
 *       - transcript_path, cwd, permission_mode
 *       - effort.level                  (string, claude-style)
 *       - tool_name, tool_use_id        (PreToolUse/PostToolUse)
 *     The full body is also persisted as `payload` JSON.
 *     -> 201 { id, received_at_ms, source_cli }
 *     -> 400 missing/blank required fields, malformed JSON
 *     -> 403 Authorization: Bearer rbt_*
 *
 *   GET  /api/cli-hook?session=<id>&limit=<n>
 *   GET  /api/cli-hook?source=<cli>&limit=<n>
 *   GET  /api/cli-hook?limit=<n>
 *     -> 200 { events: CliHookEventRow[] }
 *     -> 400 limit out of range
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  insertCliHookEvent,
  listCliHookEventsForSession,
  listRecentCliHookEvents
} from '$lib/server/cliHookEventsStore';
import { getAgentStatus, setAgentStatus } from '$lib/server/agentStatusStore';
import { mapHookEventToAgentStatus } from '$lib/server/hookEventStatusMapper';
import { getTerminalById } from '$lib/server/terminalsStore';

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;

function rejectRemoteBridgeBearer(request: Request): void {
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader.startsWith('Bearer rbt_')) {
    throw error(403, 'Remote-bridge bearer tokens cannot post hook events. Hooks are inherently local.');
  }
}

function asNonBlankString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function extractEffortLevel(payload: Record<string, unknown>): string | null {
  const effort = payload.effort;
  if (effort && typeof effort === 'object' && !Array.isArray(effort)) {
    const level = (effort as Record<string, unknown>).level;
    if (typeof level === 'string' && level.trim().length > 0) return level;
  }
  return null;
}

function resolveStatusTerminalId(body: Record<string, unknown>, fallbackSessionId: string): string {
  return asNonBlankString(body.ant_session_id)
    ?? asNonBlankString(body.terminal_id)
    ?? fallbackSessionId;
}

export const POST: RequestHandler = async ({ request, url }) => {
  rejectRemoteBridgeBearer(request);

  const sourceCli = url.searchParams.get('source') ?? undefined;

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    body = parsed as Record<string, unknown>;
  } catch (cause) {
    if (cause instanceof Response) throw cause;
    if ((cause as { status?: number } | null)?.status === 400) throw cause;
    throw error(400, 'Body must be valid JSON.');
  }

  const sessionId = asNonBlankString(body.session_id);
  if (!sessionId) {
    throw error(400, 'session_id must be a non-blank string.');
  }
  const hookEventName = asNonBlankString(body.hook_event_name);
  if (!hookEventName) {
    throw error(400, 'hook_event_name must be a non-blank string.');
  }

  const inserted = insertCliHookEvent({
    sourceCli,
    sessionId,
    hookEventName,
    transcriptPath: asNonBlankString(body.transcript_path) ?? undefined,
    cwd: asNonBlankString(body.cwd) ?? undefined,
    permissionMode: asNonBlankString(body.permission_mode) ?? undefined,
    effortLevel: extractEffortLevel(body) ?? undefined,
    toolName: asNonBlankString(body.tool_name) ?? undefined,
    toolUseId: asNonBlankString(body.tool_use_id) ?? undefined,
    payload: body
  });

  // Asks-as-pill (slice 8): the hook event also drives the agent's pill.
  // hookEventStatusMapper translates the canonical event name into one of
  // {idle, thinking, working}. response-required is asks-only and never
  // emitted here. We only write when the terminal exists (the hook may
  // fire before the terminal is registered — that's fine, the poller's
  // fingerprint fallback will pick it up later) and when the new status
  // actually differs (no-op writes pollute the audit log).
  try {
    const nextStatus = mapHookEventToAgentStatus(hookEventName);
    const statusTerminalId = resolveStatusTerminalId(body, sessionId);
    if (nextStatus && getTerminalById(statusTerminalId)) {
      const current = getAgentStatus(statusTerminalId);
      if (!current || current.agent_status !== nextStatus) {
        setAgentStatus({
          terminalId: statusTerminalId,
          newStatus: nextStatus,
          source: 'hook',
          evidence: { hookEventName, sourceCli, hookSessionId: sessionId }
        });
      }
    }
  } catch {
    // Hook-to-status is a best-effort projection. A failure here must NEVER
    // break the underlying cli_hook_events insert (which is what the rest
    // of the system depends on for retention + cross-cli traceability).
  }

  return json(
    {
      id: inserted.id,
      received_at_ms: inserted.received_at_ms,
      source_cli: inserted.source_cli
    },
    { status: 201 }
  );
};

function parseLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_LIMIT || !Number.isInteger(n)) {
    throw error(400, `limit must be a positive integer ≤ ${MAX_LIMIT}.`);
  }
  return n;
}

export const GET: RequestHandler = ({ url }) => {
  const limit = parseLimit(url.searchParams.get('limit'));
  const sessionId = url.searchParams.get('session');
  const sourceCli = url.searchParams.get('source');

  if (sessionId && sessionId.trim().length > 0) {
    return json({ events: listCliHookEventsForSession(sessionId, { limit }) });
  }
  if (sourceCli && sourceCli.trim().length > 0) {
    return json({ events: listRecentCliHookEvents({ limit, sourceCli }) });
  }
  return json({ events: listRecentCliHookEvents({ limit }) });
};
