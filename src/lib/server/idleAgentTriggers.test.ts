import { describe, expect, it, beforeEach } from 'vitest';
import {
  classifyEngagement,
  decideIdleNudge,
  computeIdleTriggers,
  resetIdleNudgeTrackerForTests,
  DEFAULT_IDLE_THRESHOLD_MS,
  DEFAULT_OFFLINE_THRESHOLD_MS
} from './idleAgentTriggers';

const NOW = 1_000_000_000_000;

beforeEach(() => resetIdleNudgeTrackerForTests());

describe('classifyEngagement', () => {
  it('working/thinking/response-required → working (canonical status wins)', () => {
    for (const status of ['working', 'thinking', 'response-required'] as const) {
      expect(
        classifyEngagement({ status, lastActivityMs: NOW - 60_000, now: NOW })
      ).toBe('working');
    }
  });

  it('idle status but recently active → still working (debounce: not idle the instant it stops)', () => {
    expect(
      classifyEngagement({ status: 'idle', lastActivityMs: NOW - 1_000, now: NOW })
    ).toBe('working');
  });

  it('idle status + quiet past the idle threshold → idle', () => {
    expect(
      classifyEngagement({ status: 'idle', lastActivityMs: NOW - DEFAULT_IDLE_THRESHOLD_MS, now: NOW })
    ).toBe('idle');
  });

  it('no activity past the offline threshold → offline regardless of status', () => {
    expect(
      classifyEngagement({ status: 'working', lastActivityMs: NOW - DEFAULT_OFFLINE_THRESHOLD_MS, now: NOW })
    ).toBe('offline');
    expect(classifyEngagement({ status: null, lastActivityMs: null, now: NOW })).toBe('offline');
  });
});

describe('decideIdleNudge', () => {
  it('only nudges idle agents, and not when already nudged', () => {
    expect(decideIdleNudge({ engagement: 'working', hasOpenWork: false, alreadyNudged: false, handle: '@a' }).shouldNudge).toBe(false);
    expect(decideIdleNudge({ engagement: 'idle', hasOpenWork: false, alreadyNudged: true, handle: '@a' }).shouldNudge).toBe(false);
    expect(decideIdleNudge({ engagement: 'idle', hasOpenWork: false, alreadyNudged: false, handle: '@a' }).shouldNudge).toBe(true);
  });

  it('text reflects whether the agent still holds open work', () => {
    const withWork = decideIdleNudge({ engagement: 'idle', hasOpenWork: true, alreadyNudged: false, handle: '@a' });
    const noWork = decideIdleNudge({ engagement: 'idle', hasOpenWork: false, alreadyNudged: false, handle: '@a' });
    expect(withWork.text).toContain('open claim');
    expect(noWork.text).toContain('claim the next slice');
  });
});

describe('computeIdleTriggers — per-room report + one-shot directed nudges', () => {
  it('produces a visible per-room report classifying each agent', () => {
    const { report } = computeIdleTriggers({
      now: NOW,
      agents: [
        { handle: '@busy', status: 'working', lastActivityMs: NOW - 1_000, hasOpenWork: true },
        { handle: '@idle', status: 'idle', lastActivityMs: NOW - DEFAULT_IDLE_THRESHOLD_MS, hasOpenWork: false },
        { handle: '@gone', status: null, lastActivityMs: null, hasOpenWork: false }
      ]
    });
    expect(report).toEqual([
      { handle: '@busy', engagement: 'working', hasOpenWork: true },
      { handle: '@idle', engagement: 'idle', hasOpenWork: false },
      { handle: '@gone', engagement: 'offline', hasOpenWork: false }
    ]);
  });

  it('ACCEPTANCE: a claim closed with no follow-up produces EXACTLY ONE nudge', () => {
    // @worker had an open claim (working), then the claim closed → now idle with
    // no follow-up work. The agent goes idle past the threshold.
    const agentsIdleNoFollowup = [
      { handle: '@worker', status: 'idle' as const, lastActivityMs: NOW - DEFAULT_IDLE_THRESHOLD_MS, hasOpenWork: false }
    ];

    // First monitor tick after it goes idle → exactly one nudge.
    const first = computeIdleTriggers({ now: NOW, agents: agentsIdleNoFollowup });
    expect(first.nudges).toEqual([
      { handle: '@worker', text: expect.stringContaining('No idling') }
    ]);

    // Still idle on the next tick → NO second nudge (one-shot per episode).
    const second = computeIdleTriggers({ now: NOW + 60_000, agents: agentsIdleNoFollowup });
    expect(second.nudges).toEqual([]);

    // Re-engaged (picks up work) → clears the guard.
    computeIdleTriggers({
      now: NOW + 120_000,
      agents: [{ handle: '@worker', status: 'working', lastActivityMs: NOW + 120_000, hasOpenWork: true }]
    });
    // Goes idle AGAIN later → eligible for a fresh nudge (new episode).
    const third = computeIdleTriggers({
      now: NOW + 600_000,
      agents: [{ handle: '@worker', status: 'idle', lastActivityMs: NOW + 600_000 - DEFAULT_IDLE_THRESHOLD_MS, hasOpenWork: false }]
    });
    expect(third.nudges).toHaveLength(1);
  });

  it('does not nudge working/offline agents (no spam)', () => {
    const { nudges } = computeIdleTriggers({
      now: NOW,
      agents: [
        { handle: '@busy', status: 'working', lastActivityMs: NOW - 1_000, hasOpenWork: true },
        { handle: '@gone', status: null, lastActivityMs: null, hasOpenWork: false }
      ]
    });
    expect(nudges).toEqual([]);
  });
});
