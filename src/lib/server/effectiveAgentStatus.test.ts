import { describe, expect, it } from 'vitest';
import { projectEffectiveAgentStatus } from './effectiveAgentStatus';

describe('projectEffectiveAgentStatus', () => {
  it('expires stale ant-activity working states to idle', () => {
    expect(projectEffectiveAgentStatus({
      agent_status: 'working',
      agent_status_source: 'ant-activity',
      agent_status_at_ms: 1_000
    }, 62_000)).toEqual({
      agent_status: 'idle',
      agent_status_source: 'default',
      agent_status_at_ms: 0
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
