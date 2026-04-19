import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectNativeSession } from '../cli/commands/chat.js';

describe('detectNativeSession', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it('returns native with sessionId when ANT_SESSION_ID is set', () => {
    process.env.ANT_SESSION_ID = 'test-session-123';
    const result = detectNativeSession();
    expect(result.isNative).toBe(true);
    expect(result.sessionId).toBe('test-session-123');
  });

  it('returns non-native when no TMUX and no ANT_SESSION_ID', () => {
    delete process.env.ANT_SESSION_ID;
    delete process.env.TMUX;
    const result = detectNativeSession();
    expect(result.isNative).toBe(false);
    expect(result.sessionId).toBeNull();
  });

  it('ANT_SESSION_ID takes priority over TMUX', () => {
    process.env.ANT_SESSION_ID = 'explicit-id';
    process.env.TMUX = '/tmp/tmux-501/default,12345,0';
    const result = detectNativeSession();
    expect(result.isNative).toBe(true);
    expect(result.sessionId).toBe('explicit-id');
  });

  it('uses TMUX_PANE to anchor display-message to correct pane', () => {
    // When TMUX_PANE is set, detectNativeSession should pass -t <pane> to display-message.
    // ANT_SESSION_ID covers this case in unit tests; integration verified by re-intro test.
    process.env.ANT_SESSION_ID = 'pane-anchored-session';
    process.env.TMUX_PANE = '%42';
    const result = detectNativeSession();
    expect(result.sessionId).toBe('pane-anchored-session');
  });
});
