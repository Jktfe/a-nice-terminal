import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROMPT_BRIDGE_CONFIG,
  detectPromptLike,
  normalisePromptBridgeConfig,
  parsePromptBridgeTarget,
} from '../src/lib/server/prompt-bridge.js';

describe('prompt bridge', () => {
  it('detects generic prompt-like terminal text without classifying the action', () => {
    const excerpt = detectPromptLike([
      'Working on files...',
      'Do you want to continue?',
    ]);

    expect(excerpt).toContain('Do you want to continue?');
  });

  it('ignores ordinary progress output', () => {
    const excerpt = detectPromptLike([
      'Reading 3 files',
      'Running tests',
      '12 passing',
    ]);

    expect(excerpt).toBeNull();
  });

  it('normalises config and leaves the bridge disabled by default', () => {
    const config = normalisePromptBridgeConfig({
      enabled: true,
      default_targets: [{ kind: 'chat', session_id: 'room-1' }],
      detect: { min_interval_ms: 5000, window_lines: 5 },
    });

    expect(DEFAULT_PROMPT_BRIDGE_CONFIG.enabled).toBe(false);
    expect(config.enabled).toBe(true);
    expect(config.default_targets).toEqual([{ kind: 'chat', session_id: 'room-1' }]);
    expect(config.detect.min_interval_ms).toBe(5000);
    expect(config.detect.patterns.length).toBeGreaterThan(0);
  });

  it('parses CLI target shorthands', () => {
    expect(parsePromptBridgeTarget('linked')).toEqual({ kind: 'linked_chat' });
    expect(parsePromptBridgeTarget('chat:abc')).toEqual({ kind: 'chat', session_id: 'abc' });
    expect(parsePromptBridgeTarget('webhook:https://example.test/hook')).toEqual({
      kind: 'webhook',
      url: 'https://example.test/hook',
    });
  });
});
