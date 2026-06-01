/**
 * codexTranscriptTailWatcher — TRANSCRIPT-TAIL-CODEX-v2 wrapper.
 * Phase-1 thin wrapper around genericTranscriptTailWatcher.
 * Preserves exact exports for backward compatibility.
 */

import {
  tailOnceForTerminal as genericTailOnce,
  tailAllOnce as genericTailAll,
  ensureGenericTranscriptTailWatcherBooted,
  _resetGenericTranscriptTailStateForTests,
  _internals as genericInternals
} from './genericTranscriptTailWatcher';
import { registerAllTranscriptTailParsers } from './parsers';
import { firstLine, readAppendedBytes } from './parsers/_shared';

const BOOT_KEY = '__antCodexTranscriptTailBooted';
const CODEX_KINDS = new Set(['codex', 'codex-cli']);

registerAllTranscriptTailParsers();

export function tailOnceForTerminal(record: {
  session_id: string;
  agent_kind: string | null;
  tmux_target_pane: string | null;
  created_at_ms: number;
}): number {
  if (!record.agent_kind || !CODEX_KINDS.has(record.agent_kind)) return 0;
  return genericTailOnce(record);
}

export function tailAllOnce(): number {
  return genericTailAll();
}

export function ensureCodexTranscriptTailWatcherBooted(): void {
  ensureGenericTranscriptTailWatcherBooted();
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[BOOT_KEY]) return;
  g[BOOT_KEY] = true;
}

export function _resetCodexTranscriptTailStateForTests(): void {
  _resetGenericTranscriptTailStateForTests();
}

export const _internals = {
  firstLine,
  readAppendedBytes,
  tailStates: genericInternals.tailStates,
  CODEX_KINDS,
  POLL_INTERVAL_MS: genericInternals.POLL_INTERVAL_MS
};
