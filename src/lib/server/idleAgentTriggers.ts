/**
 * idleAgentTriggers — the "agents must not sit idle" trigger + monitor layer.
 *
 * JWPK 2026-06-06 (post-theatre): rooms were full of idle agents because
 * FINISHING a task doesn't re-engage an agent — there was no completion→next
 * trigger and no idle monitoring. This module is the POLICY layer:
 *   • classifies engagement (working / idle / offline) over the canonical agent
 *     status (task #70's agentStatusStore — CONSUMED, never re-derived) + last
 *     activity,
 *   • decides a ONE-SHOT directed nudge when an agent goes idle (so finishing ≠
 *     idling),
 *   • produces a per-room idle report for the controller.
 *
 * No room spam: this module returns nudge DECISIONS; the caller sends them as
 * DIRECTED relays (sendCoordinationRelay). Pure + unit-testable — the per-agent
 * facts are supplied by the caller, so the policy is decoupled from the
 * specific status/claim wiring and adapts if #70 lands a canonical status API.
 */

import type { AgentStatus } from './agentStatusStore';

export type Engagement = 'working' | 'idle' | 'offline';

export const DEFAULT_IDLE_THRESHOLD_MS = 5 * 60_000; // 5 min quiet + idle status
export const DEFAULT_OFFLINE_THRESHOLD_MS = 30 * 60_000; // 30 min no activity

/**
 * Classify an agent's engagement. The canonical status wins when it reports
 * active engagement (working/thinking/response-required); 'idle' status only
 * counts as idle once the agent has also been quiet past the idle threshold
 * (debounce — a just-finished agent isn't "idle" the instant it stops typing).
 * No activity past the offline threshold → offline regardless of status.
 */
export function classifyEngagement(input: {
  status: AgentStatus | null;
  lastActivityMs: number | null;
  now: number;
  idleThresholdMs?: number;
  offlineThresholdMs?: number;
}): Engagement {
  const idleMs = input.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
  const offlineMs = input.offlineThresholdMs ?? DEFAULT_OFFLINE_THRESHOLD_MS;
  const sinceActivity =
    input.lastActivityMs === null ? Infinity : input.now - input.lastActivityMs;

  if (sinceActivity >= offlineMs) return 'offline';
  if (
    input.status === 'working' ||
    input.status === 'thinking' ||
    input.status === 'response-required'
  ) {
    return 'working';
  }
  if (input.status === 'idle' && sinceActivity >= idleMs) return 'idle';
  return 'working';
}

export type NudgeDecision = { shouldNudge: boolean; text?: string };

/**
 * Decide whether to fire a completion→next nudge. Only idle agents are nudged,
 * and only ONCE per idle episode (alreadyNudged guard). The text differs by
 * whether the agent still holds open work (push it / report blocked) vs has a
 * clear lane (claim the next slice).
 */
export function decideIdleNudge(input: {
  engagement: Engagement;
  hasOpenWork: boolean;
  alreadyNudged: boolean;
  handle: string;
}): NudgeDecision {
  if (input.engagement !== 'idle' || input.alreadyNudged) return { shouldNudge: false };
  const text = input.hasOpenWork
    ? `⏳ ${input.handle}: you've gone idle with an open claim — push it forward to the next reviewable step or post a blocker. Don't sit.`
    : `⏳ ${input.handle}: idle with no open work — claim the next slice, review a peer's commit, or post that your lane is clear. No idling.`;
  return { shouldNudge: true, text };
}

export type IdleReportRow = { handle: string; engagement: Engagement; hasOpenWork: boolean };
export type PendingNudge = { handle: string; text: string };

// One-shot per idle EPISODE: a nudged handle stays suppressed until it is seen
// non-idle again (re-engaged), then becomes eligible for the NEXT idle episode.
// In-memory is fine — a restart simply re-nudges, which is the safe direction.
const nudgedHandles = new Set<string>();

export function resetIdleNudgeTrackerForTests(): void {
  nudgedHandles.clear();
}

/**
 * Given per-agent facts (handle, canonical status, last activity, open-work),
 * return the per-room idle REPORT + the ONE-SHOT directed nudges to send. The
 * caller gathers the facts (room members → getAgentStatus + claim state) and
 * delivers each nudge via sendCoordinationRelay (directed, never a room post).
 */
export function computeIdleTriggers(input: {
  agents: Array<{
    handle: string;
    status: AgentStatus | null;
    lastActivityMs: number | null;
    hasOpenWork: boolean;
  }>;
  now: number;
  idleThresholdMs?: number;
  offlineThresholdMs?: number;
}): { report: IdleReportRow[]; nudges: PendingNudge[] } {
  const report: IdleReportRow[] = [];
  const nudges: PendingNudge[] = [];
  for (const agent of input.agents) {
    const engagement = classifyEngagement({
      status: agent.status,
      lastActivityMs: agent.lastActivityMs,
      now: input.now,
      idleThresholdMs: input.idleThresholdMs,
      offlineThresholdMs: input.offlineThresholdMs
    });
    report.push({ handle: agent.handle, engagement, hasOpenWork: agent.hasOpenWork });

    if (engagement !== 'idle') {
      // Re-engaged (or offline) → clear the one-shot so the NEXT idle re-nudges.
      nudgedHandles.delete(agent.handle);
      continue;
    }
    const decision = decideIdleNudge({
      engagement,
      hasOpenWork: agent.hasOpenWork,
      alreadyNudged: nudgedHandles.has(agent.handle),
      handle: agent.handle
    });
    if (decision.shouldNudge && decision.text) {
      nudges.push({ handle: agent.handle, text: decision.text });
      nudgedHandles.add(agent.handle);
    }
  }
  return { report, nudges };
}
