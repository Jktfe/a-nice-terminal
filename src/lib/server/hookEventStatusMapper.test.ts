/**
 * Pure mapping tests for hookEventStatusMapper. Asks-as-pill JWPK 2026-05-22
 * cascade inversion — the mapper is what /api/cli-hook calls to derive an
 * agent_status from a hook event name.
 */
import { describe, expect, it } from 'vitest';
import { mapHookEventToAgentStatus } from './hookEventStatusMapper';

describe('mapHookEventToAgentStatus', () => {
  it('PreToolUse / tool_use_start / UserPromptSubmit → working', () => {
    expect(mapHookEventToAgentStatus('PreToolUse')).toBe('working');
    expect(mapHookEventToAgentStatus('tool_use_start')).toBe('working');
    expect(mapHookEventToAgentStatus('UserPromptSubmit')).toBe('working');
  });

  it('PostToolUse / tool_use_stop / Stop / SubagentStop → idle', () => {
    expect(mapHookEventToAgentStatus('PostToolUse')).toBe('idle');
    expect(mapHookEventToAgentStatus('tool_use_stop')).toBe('idle');
    expect(mapHookEventToAgentStatus('Stop')).toBe('idle');
    expect(mapHookEventToAgentStatus('SubagentStop')).toBe('idle');
  });

  it('Notification / ThinkingStart / thinking → thinking', () => {
    expect(mapHookEventToAgentStatus('Notification')).toBe('thinking');
    expect(mapHookEventToAgentStatus('ThinkingStart')).toBe('thinking');
    expect(mapHookEventToAgentStatus('thinking')).toBe('thinking');
  });

  it('NEVER maps to response-required (that state is asks-only)', () => {
    const eventNames = [
      'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop',
      'Notification', 'tool_use_start', 'tool_use_stop',
      'UserPromptSubmit', 'ThinkingStart', 'thinking'
    ];
    for (const name of eventNames) {
      expect(mapHookEventToAgentStatus(name)).not.toBe('response-required');
    }
  });

  it('unknown event names → null (no-op for caller)', () => {
    expect(mapHookEventToAgentStatus('CompletelyMadeUp')).toBeNull();
    expect(mapHookEventToAgentStatus('')).toBeNull();
    expect(mapHookEventToAgentStatus('post-tool-use')).toBeNull(); // case sensitive
  });
});
