/**
 * piTranscriptTailWatcher — TRANSCRIPT-TAIL-PI-v2 wrapper.
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
import { findNewestJsonl, readAppendedBytes } from './parsers/_shared';

const BOOT_KEY = '__antPiTranscriptTailBooted';
const PI_KINDS = new Set(['pi']);

registerAllTranscriptTailParsers();

export function encodedCwdSegmentForPi(cwd: string): string {
  return `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`;
}

export function tailOnceForTerminal(record: {
  session_id: string;
  agent_kind: string | null;
  tmux_target_pane: string | null;
  created_at_ms: number;
}): number {
  if (!record.agent_kind || !PI_KINDS.has(record.agent_kind)) return 0;
  return genericTailOnce(record);
}

export function tailAllOnce(): number {
  return genericTailAll();
}

export function ensurePiTranscriptTailWatcherBooted(): void {
  ensureGenericTranscriptTailWatcherBooted();
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[BOOT_KEY]) return;
  g[BOOT_KEY] = true;
}

export function _resetPiTranscriptTailStateForTests(): void {
  _resetGenericTranscriptTailStateForTests();
}

export const _internals = {
  findNewestJsonl,
  readAppendedBytes,
  tailStates: genericInternals.tailStates,
  PI_KINDS,
  POLL_INTERVAL_MS: genericInternals.POLL_INTERVAL_MS
};
