/**
 * geminiTranscriptTailWatcher — TRANSCRIPT-TAIL-GEMINI-v2 wrapper.
 * Phase-1 thin wrapper around genericTranscriptTailWatcher.
 */

import {
  tailOnceForTerminal as genericTailOnce,
  tailAllOnce as genericTailAll,
  ensureGenericTranscriptTailWatcherBooted,
  _resetGenericTranscriptTailStateForTests,
  _internals as genericInternals
} from './genericTranscriptTailWatcher';
import { registerAllTranscriptTailParsers } from './parsers';
import { findNewestSessionJsonl, readAppendedBytes } from './parsers/_shared';

const BOOT_KEY = '__antGeminiTranscriptTailBooted';
const GEMINI_KINDS = new Set(['gemini', 'gemini-cli']);

registerAllTranscriptTailParsers();

export function tailOnceForTerminal(record: {
  session_id: string;
  agent_kind: string | null;
  tmux_target_pane: string | null;
  created_at_ms: number;
}): number {
  if (!record.agent_kind || !GEMINI_KINDS.has(record.agent_kind)) return 0;
  return genericTailOnce(record);
}

export function tailAllOnce(): number {
  return genericTailAll();
}

export function ensureGeminiTranscriptTailWatcherBooted(): void {
  ensureGenericTranscriptTailWatcherBooted();
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[BOOT_KEY]) return;
  g[BOOT_KEY] = true;
}

export function _resetGeminiTranscriptTailStateForTests(): void {
  _resetGenericTranscriptTailStateForTests();
}

export const _internals = {
  findNewestSessionJsonl,
  readAppendedBytes,
  tailStates: genericInternals.tailStates,
  GEMINI_KINDS,
  POLL_INTERVAL_MS: genericInternals.POLL_INTERVAL_MS
};
