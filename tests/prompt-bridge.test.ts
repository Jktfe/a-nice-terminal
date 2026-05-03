import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PROMPT_BRIDGE_CONFIG,
  detectPromptLike,
  disposePromptBridge,
  feedPromptBridge,
  getPendingPrompt,
  initPromptBridge,
  normalisePromptBridgeConfig,
  parsePromptBridgeTarget,
  respondToPrompt,
  sessionSupportsPromptBridge,
  setPromptBridgeConfig,
} from '../src/lib/server/prompt-bridge.js';

const TEST_TERMINAL = 'prompt-bridge-cli-terminal';
const PLAIN_TERMINAL = 'prompt-bridge-plain-terminal';

describe('prompt bridge', () => {
  afterEach(() => {
    disposePromptBridge(TEST_TERMINAL);
    disposePromptBridge(PLAIN_TERMINAL);
    setPromptBridgeConfig(DEFAULT_PROMPT_BRIDGE_CONFIG);
  });

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

  it('gates prompt visibility to terminal sessions with a CLI driver', () => {
    expect(sessionSupportsPromptBridge({ type: 'terminal', cli_flag: 'codex-cli' })).toBe(true);
    expect(sessionSupportsPromptBridge({
      type: 'terminal',
      meta: JSON.stringify({ agent_driver: 'claude-code' }),
    })).toBe(true);
    expect(sessionSupportsPromptBridge({ type: 'terminal', meta: '{}' })).toBe(false);
    expect(sessionSupportsPromptBridge({ type: 'chat', cli_flag: 'codex-cli' })).toBe(false);
  });

  it('broadcasts prompt-bridge pending state without adding status timeline rows', async () => {
    const broadcasts: any[] = [];
    const runEvents: any[] = [];
    const writes: string[] = [];

    setPromptBridgeConfig({
      ...DEFAULT_PROMPT_BRIDGE_CONFIG,
      enabled: true,
      detect: {
        ...DEFAULT_PROMPT_BRIDGE_CONFIG.detect,
        min_interval_ms: 1,
      },
    });
    initPromptBridge({
      getSession: (id: string) => id === TEST_TERMINAL
        ? { id, type: 'terminal', name: 'Codex', linked_chat_id: 'linked-chat', cli_flag: 'codex-cli' }
        : null,
      postToChat: () => {},
      writeToTerminal: (_sessionId: string, data: string) => { writes.push(data); },
      broadcastGlobal: (msg: any) => { broadcasts.push(msg); },
      appendRunEvent: (...args: any[]) => { runEvents.push(args); },
    });

    await feedPromptBridge(TEST_TERMINAL, 'Do you want to continue?');

    expect(getPendingPrompt(TEST_TERMINAL)?.status).toBe('pending');
    expect(broadcasts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'session_needs_input',
        sessionId: TEST_TERMINAL,
        eventClass: 'prompt_bridge',
        source: 'prompt_bridge',
        summary: 'Do you want to continue?',
      }),
    ]));
    expect(runEvents.some(([, source, , kind]) => source === 'status' || kind === 'status')).toBe(false);

    await respondToPrompt(TEST_TERMINAL, 'yes', { enter: false });

    expect(writes).toEqual(['yes']);
    expect(broadcasts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'session_input_resolved',
        sessionId: TEST_TERMINAL,
        source: 'prompt_bridge',
      }),
    ]));
  });

  it('does not surface prompt-bridge state for plain terminals', async () => {
    const broadcasts: any[] = [];

    setPromptBridgeConfig({
      ...DEFAULT_PROMPT_BRIDGE_CONFIG,
      enabled: true,
    });
    initPromptBridge({
      getSession: (id: string) => id === PLAIN_TERMINAL
        ? { id, type: 'terminal', name: 'Plain terminal', linked_chat_id: 'linked-chat', meta: '{}' }
        : null,
      postToChat: () => {},
      writeToTerminal: () => {},
      broadcastGlobal: (msg: any) => { broadcasts.push(msg); },
      appendRunEvent: () => {},
    });

    await feedPromptBridge(PLAIN_TERMINAL, 'Do you want to continue?');

    expect(getPendingPrompt(PLAIN_TERMINAL)).toBeNull();
    expect(broadcasts).toEqual([]);
  });
});
