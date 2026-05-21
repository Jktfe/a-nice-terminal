/**
 * agentKindResolver — sessionId → normalized agent_kind for the Layer A
 * boot dispatch. Looks up the existing M3.x terminals table first; future
 * slices may extend this to terminal_records once fingerprintDetector is
 * wired into daemon-spawned sessions. Aliases (claude_code ↔ claude-code)
 * normalize to the registry's canonical key.
 */

import { getIdentityDb } from '../db';

const ALIASES: Record<string, string> = {
  'claude_code': 'claude-code',
  'claude-code': 'claude-code',
  // T-AGENT-LIST-SETTINGS (2026-05-14): JWPK short label `claude` must
  // also normalize to canonical `claude-code` so Layer A interactive
  // detection fires for terminals labelled with the short form.
  'claude': 'claude-code'
};

export function resolveAgentKind(sessionId: string): string | null {
  if (sessionId.length === 0) return null;
  let kind: string | null = null;
  try {
    const db = getIdentityDb();
    // Prefer the existing M3.x terminals row when one exists (pid-bound).
    const m3 = db.prepare(`SELECT agent_kind FROM terminals WHERE id = ?`).get(sessionId) as
      | { agent_kind: string | null } | undefined;
    if (m3 && m3.agent_kind) {
      kind = m3.agent_kind;
    } else {
      // Fall back to the JWPK-visible terminal_records table for daemon-
      // spawned sessions (T2b-impl-1 autodetect-wiring slice 2026-05-14).
      const tr = db.prepare(`SELECT agent_kind FROM terminal_records WHERE session_id = ?`).get(sessionId) as
        | { agent_kind: string | null } | undefined;
      if (tr && tr.agent_kind) kind = tr.agent_kind;
    }
  } catch { /* table may not exist in stripped test envs */ }
  if (!kind) return null;
  return ALIASES[kind] ?? kind;
}
