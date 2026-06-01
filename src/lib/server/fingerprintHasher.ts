/**
 * fingerprintHasher — agent-status cascade.
 *
 * Cascade (asks-as-pill JWPK 2026-05-22 — INVERTED from the v2 order):
 *   1. Hook push PRIMARY — explicit tool_use_start/stop/Stop/Notification
 *      events translated by hookEventStatusMapper, written by
 *      /api/cli-hook. Trust the agent's own emissions over heuristic
 *      tmux pattern-matching.
 *   2. Fingerprint FALLBACK — kept for (a) unknown CLIs without a hook
 *      bridge yet and (b) catching dead/hung agents the hook never closed
 *      out. Only consulted when no fresh hook event exists for the
 *      terminal (poller's responsibility — see agentStatusPoller).
 *   3. ANT activity / PID CPU — legacy sources retained as last-resort
 *      tiebreakers but no live writer wires them in production.
 *   4. Default idle.
 *
 * ASK_PATTERN regex DELETED: response-required is now derived from the
 * asks store (humans only). Agents only ever wear idle/thinking/working;
 * tmux output never drives the pill.
 */

import { createHash } from 'node:crypto';
import type { AgentStatus, AgentStatusSource } from './agentStatusStore';

const TOOL_CALL_SIGNATURE = /⏺|🔧|^→ /m;
const FINGERPRINT_STALE_MS = 30_000;
const FINGERPRINT_CHANGE_FRESH_MS = 5_000;
const ANT_ACTIVITY_FRESH_MS = 60_000;
const PID_CPU_HIGH_PERCENT = 30;

export type FingerprintInput = {
  captureText: string;
  prevHash: string | null;
  prevAtMs: number | null;
  nowMs: number;
};

export type FingerprintDecision = {
  status: AgentStatus | null;
  hash: string;
  evidence: { hashChanged: boolean; ageMs: number };
};

export function hashCaptureOutput(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function deriveStateFromFingerprint(input: FingerprintInput): FingerprintDecision {
  const newHash = hashCaptureOutput(input.captureText);
  const hashChanged = input.prevHash !== null && input.prevHash !== newHash;
  const ageMs = input.prevAtMs !== null ? input.nowMs - input.prevAtMs : Number.POSITIVE_INFINITY;
  const evidence = { hashChanged, ageMs };

  // ASK_PATTERN check removed — response-required is asks-store-derived, not
  // fingerprint-derived. See askStore.hasResponseRequiredAsksForHandle.
  if (hashChanged && ageMs < FINGERPRINT_CHANGE_FRESH_MS && TOOL_CALL_SIGNATURE.test(input.captureText)) {
    return { status: 'working', hash: newHash, evidence };
  }
  if (hashChanged && ageMs < FINGERPRINT_CHANGE_FRESH_MS) return { status: 'thinking', hash: newHash, evidence };
  if (!hashChanged && ageMs > FINGERPRINT_STALE_MS) return { status: 'idle', hash: newHash, evidence };
  return { status: null, hash: newHash, evidence };
}

export type CascadeInput = {
  fingerprint: FingerprintDecision | null;
  hookPush: { status: AgentStatus; nonceValid: boolean; ageMs: number } | null;
  antActivity: { lastMessageAgeMs: number | null; lastPtyAgeMs: number | null } | null;
  pidCpu: { cpuPercent: number; samplesValid: boolean } | null;
};

export type CascadeDecision = {
  status: AgentStatus;
  source: AgentStatusSource;
  evidence: Record<string, unknown>;
};

export function decideAgentStatus(input: CascadeInput): CascadeDecision {
  // Hook PRIMARY (asks-as-pill JWPK 2026-05-22 inversion). The agent's
  // explicit emissions beat heuristic fingerprint regex matches.
  if (input.hookPush?.nonceValid && input.hookPush.ageMs < FINGERPRINT_STALE_MS) {
    return { status: input.hookPush.status, source: 'hook', evidence: { ageMs: input.hookPush.ageMs } };
  }
  // Fingerprint FALLBACK. Only consulted when hook is absent/stale — the
  // poller's job is to skip the fingerprint sample entirely when a fresh
  // hook event already covers the terminal.
  if (input.fingerprint?.status) {
    return { status: input.fingerprint.status, source: 'fingerprint', evidence: input.fingerprint.evidence };
  }
  if (input.antActivity) {
    const recentMsg = input.antActivity.lastMessageAgeMs !== null && input.antActivity.lastMessageAgeMs < ANT_ACTIVITY_FRESH_MS;
    const recentPty = input.antActivity.lastPtyAgeMs !== null && input.antActivity.lastPtyAgeMs < ANT_ACTIVITY_FRESH_MS;
    if (recentMsg && recentPty) return { status: 'working', source: 'ant-activity', evidence: input.antActivity };
    if (recentMsg) return { status: 'response-required', source: 'ant-activity', evidence: input.antActivity };
    if (recentPty) return { status: 'working', source: 'ant-activity', evidence: input.antActivity };
  }
  if (input.pidCpu?.samplesValid) {
    if (input.pidCpu.cpuPercent > PID_CPU_HIGH_PERCENT) {
      return { status: 'thinking', source: 'pid-cpu', evidence: input.pidCpu };
    }
    return { status: 'idle', source: 'pid-cpu', evidence: input.pidCpu };
  }
  return { status: 'idle', source: 'default', evidence: {} };
}
