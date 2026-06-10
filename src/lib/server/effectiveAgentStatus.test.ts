import { describe, expect, it } from 'vitest';
import { projectEffectiveAgentStatus } from './effectiveAgentStatus';

describe('projectEffectiveAgentStatus', () => {
  it('expires stale ant-activity working states to idle', () => {
    expect(projectEffectiveAgentStatus({
      agent_status: 'working',
      agent_status_source: 'ant-activity',
      agent_status_at_ms: 1_000
    }, 302_000)).toEqual({
      agent_status: 'idle',
      agent_status_source: 'default',
      agent_status_at_ms: 0
    });
  });

  it('keeps transition-based working states active inside the quiet work window', () => {
    expect(projectEffectiveAgentStatus({
      agent_status: 'working',
      agent_status_source: 'hook',
      agent_status_at_ms: 10_000
    }, 250_000)).toMatchObject({
      agent_status: 'working',
      agent_status_source: 'hook',
      agent_status_at_ms: 10_000
    });
  });

  it('keeps fresh hook working states active', () => {
    expect(projectEffectiveAgentStatus({
      agent_status: 'working',
      agent_status_source: 'hook',
      agent_status_at_ms: 10_000
    }, 20_000)).toMatchObject({
      agent_status: 'working',
      agent_status_source: 'hook',
      agent_status_at_ms: 10_000
    });
  });

  it('promotes fresh PTY output to working even when the stored status is idle', () => {
    expect(projectEffectiveAgentStatus({
      agent_status: 'idle',
      agent_status_source: 'default',
      agent_status_at_ms: 0,
      last_pty_byte_at_ms: 290_000
    }, 300_000)).toMatchObject({
      agent_status: 'working',
      agent_status_source: 'ant-activity',
      agent_status_at_ms: 290_000
    });
  });

  it('does not promote old PTY output after the output freshness window', () => {
    expect(projectEffectiveAgentStatus({
      agent_status: 'idle',
      agent_status_source: 'default',
      agent_status_at_ms: 0,
      last_pty_byte_at_ms: 1_000
    }, 302_000)).toMatchObject({
      agent_status: 'idle',
      agent_status_source: 'default',
      agent_status_at_ms: 0
    });
  });

  // feat/status-cascade 2026-06-10: 'pane' (pane-label re-promotion) is
  // staleness-governed exactly like the other live sources.
  it('keeps fresh pane-promoted working states active and expires stale ones', () => {
    expect(projectEffectiveAgentStatus({
      agent_status: 'working',
      agent_status_source: 'pane',
      agent_status_at_ms: 10_000
    }, 20_000)).toMatchObject({
      agent_status: 'working',
      agent_status_source: 'pane',
      agent_status_at_ms: 10_000
    });
    expect(projectEffectiveAgentStatus({
      agent_status: 'working',
      agent_status_source: 'pane',
      agent_status_at_ms: 1_000
    }, 302_000)).toEqual({
      agent_status: 'idle',
      agent_status_source: 'default',
      agent_status_at_ms: 0
    });
  });

  it('does not expire response-required states', () => {
    expect(projectEffectiveAgentStatus({
      agent_status: 'response-required',
      agent_status_source: 'fingerprint',
      agent_status_at_ms: 1_000
    }, 3_600_000)).toMatchObject({
      agent_status: 'response-required',
      agent_status_source: 'fingerprint',
      agent_status_at_ms: 1_000
    });
  });
});
