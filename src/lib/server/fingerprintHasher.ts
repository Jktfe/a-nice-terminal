/**
 * fingerprintHasher — M3.4a-v2 source-priority cascade (T2).
 *
 * Two pure exports:
 *   hashCaptureOutput(text)            → SHA256 hash of tmux capture-pane text
 *   deriveStateFromFingerprint(input)  → fingerprint-only decision + hash + evidence
 *   decideAgentStatus(cascade)         → final agent_status + source per FL2 cascade
 *
 * Priority cascade (per contract Q4 lock + JWPK FL2 2026-05-13):
 *   1. Fingerprint PRIMARY when fresh+can-decide
 *   2. Hook push SECONDARY when fingerprint stale-or-null
 *   3. ANT activity TERTIARY when above null
 *   4. PID CPU TIEBREAKER when above null
 *   5. Default idle
 *
 * Hook NEVER wins over a fresh fingerprint decision (contract B1 lock).
 */

import { createHash } from 'node:crypto';
import type { AgentStatus, AgentStatusSource } from './agentStatusStore';

const ASK_PATTERN = /Awaiting|What should|Need direction|🙋‍♂️/i;
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

  if (ASK_PATTERN.test(input.captureText)) return { status: 'response-required', hash: newHash, evidence };
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
  if (input.fingerprint?.status) {
    return { status: input.fingerprint.status, source: 'fingerprint', evidence: input.fingerprint.evidence };
  }
  if (input.hookPush?.nonceValid && input.hookPush.ageMs < FINGERPRINT_STALE_MS) {
    return { status: input.hookPush.status, source: 'hook', evidence: { ageMs: input.hookPush.ageMs } };
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
