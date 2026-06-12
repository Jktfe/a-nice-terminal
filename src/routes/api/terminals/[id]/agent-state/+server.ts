/**
 * GET /api/terminals/[id]/agent-state
 *
 * Returns the most relevant ~/.ant/state/<cli>/*.json snapshot for the
 * given terminal — feeds claude2's TerminalHeader status badge.
 *
 * Resolution:
 *   1. Resolve terminal_record by sessionId (404 if missing).
 *   2. Map agentKind → AgentCli (claude/claude-code → claude-code, etc).
 *   3. Resolve cwd via tmux display-message #{pane_current_path}.
 *   4. Lookup precedence: sessionId (rare match) → cwd → cwdBasename.
 *   5. Return snapshot JSON or { snapshot: null } when no state file exists.
 *
 * Per researchant follow-up option 1 (2026-05-15) — complements the
 * AGENT-STATE-READER lift slice. Zero claude2 collision: no
 * agent-status.ts changes here.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawnSync } from 'node:child_process';
import { getTerminalRecord } from '$lib/server/terminalRecordsStore';
import {
  findStateForSessionId,
  findStateForCwd,
  findStateForCwdBasename,
  type AgentCli
} from '$lib/server/agentStateReader';
import { basename } from 'node:path';
import { TMUX_BIN } from '$lib/server/tmuxBin';

const AGENT_KIND_TO_CLI: Record<string, AgentCli> = {
  'claude': 'claude-code',
  'claude-code': 'claude-code',
  'claude_code': 'claude-code',
  'codex': 'codex-cli',
  'codex-cli': 'codex-cli',
  'gemini': 'gemini-cli',
  'gemini-cli': 'gemini-cli',
  'qwen': 'qwen-cli',
  'qwen-cli': 'qwen-cli',
  'pi': 'pi',
  'copilot': 'copilot-cli',
  'copilot-cli': 'copilot-cli',
  'agy': 'antigravity',
  'antigravity': 'antigravity'
};

function tmuxPaneCurrentPath(pane: string): string | null {
  if (!pane) return null;
  try {
    const r = spawnSync(TMUX_BIN, [
      'display-message', '-p', '-t', pane, '#{pane_current_path}'
    ]);
    if (r.status !== 0) return null;
    const path = (r.stdout?.toString('utf8') ?? '').trim();
    return path.length > 0 ? path : null;
  } catch { return null; }
}

export const GET: RequestHandler = async ({ params }) => {
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'sessionId required.');
  const record = getTerminalRecord(sessionId);
  if (!record) throw error(404, 'terminal not found');
  const agentKind = record.agent_kind;
  if (!agentKind) return json({ snapshot: null, reason: 'agent_kind=null' });
  const cli = AGENT_KIND_TO_CLI[agentKind];
  if (!cli) return json({ snapshot: null, reason: `unsupported agent_kind: ${agentKind}` });

  // Lookup precedence: sessionId → cwd → cwdBasename.
  let snapshot = findStateForSessionId(cli, sessionId);
  if (!snapshot) {
    const pane = record.tmux_target_pane;
    const cwd = pane ? tmuxPaneCurrentPath(pane) : null;
    if (cwd) {
      snapshot = findStateForCwd(cli, cwd) ?? findStateForCwdBasename(cli, basename(cwd));
    }
  }
  if (!snapshot) return json({ snapshot: null, reason: 'no state file matched' });
  return json({ snapshot });
};
