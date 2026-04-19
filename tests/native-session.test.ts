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
});
