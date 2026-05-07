import { describe, it, expect } from 'vitest';
import { ClaudeCodeDriver } from '../src/drivers/claude-code/driver.js';
import { CodexCliDriver } from '../src/drivers/codex-cli/driver.js';
import { CopilotCliDriver } from '../src/drivers/copilot-cli/driver.js';
import { GeminiCliDriver } from '../src/drivers/gemini-cli/driver.js';
import { QwenCliDriver } from '../src/drivers/qwen-cli/driver.js';
import { discardAllPendingEvents, dispose, feed, feedStatus, getPendingEvent, init, markTerminalActivity, trackEvent } from '../src/lib/server/agent-event-bus.js';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('agent status line parsing', () => {
  it('parses Claude model, context, rate limit, workspace, and branch', () => {
    const driver = new ClaudeCodeDriver();
    const status = driver.detectStatus([
      'dev@workstation    sample-app main    Opus 4.6 1M context    ctx:94%    5h:81%',
    ]);

    expect(status).toMatchObject({
      state: 'ready',
      model: 'Opus 4.6',
      contextUsedPct: 94,
      contextRemainingPct: 6,
      rateLimitPct: 81,
      rateLimitWindow: '5h',
      workspace: 'sample-app',
      branch: 'main',
    });
  });

  it('parses Codex ready state, model, workspace, and remaining context', () => {
    const driver = new CodexCliDriver();
    const status = driver.detectStatus([
      'gpt-5.5 xhigh · /CascadeProjects/newmodelgvpl · Ready · Context 100% left',
    ]);

    expect(status).toMatchObject({
      state: 'ready',
      model: 'gpt-5.5 xhigh',
      contextUsedPct: 0,
      contextRemainingPct: 100,
      workspace: '/CascadeProjects/newmodelgvpl',
    });
  });

  it('parses Gemini footer table values as a ready telemetry snapshot', () => {
    const driver = new GeminiCliDriver();
    const status = driver.detectStatus([
      ' workspace /directory                                             branch                                    /model                                              context',
      ' /CascadeProjects/newmodelgvpl                                     main                                      Auto Gemini 3                                     0% used',
    ]);

    expect(status).toMatchObject({
      state: 'ready',
      model: 'Auto Gemini 3',
      contextUsedPct: 0,
      contextRemainingPct: 100,
      workspace: '/CascadeProjects/newmodelgvpl',
      branch: 'main',
    });
  });

  it('parses Copilot model, workspace, branch, and ready state', () => {
    const driver = new CopilotCliDriver();
    const status = driver.detectStatus([
      '~/CascadeProjects/a-nice-terminal [⎇ main*%]',
      ' / commands · ? help                                      Claude Sonnet 4.6',
      '❯ ',
    ]);

    expect(status).toMatchObject({
      state: 'ready',
      model: 'Claude Sonnet 4.6',
      workspace: '~/CascadeProjects/a-nice-terminal',
      branch: 'main',
    });
  });

  it('parses Qwen model, workspace, and ready state', () => {
    const driver = new QwenCliDriver();
    const status = driver.detectStatus([
      '>_ Qwen Code (v0.15.3)',
      'API Key | qwen3.6:latest (/model to change)',
      '~/CascadeProjects/a-nice-terminal',
      '*   Type your message or @path/to/file',
      'YOLO mode (shift + tab to cycle)',
    ]);

    expect(status).toMatchObject({
      state: 'ready',
      model: 'qwen3.6:latest',
      workspace: '~/CascadeProjects/a-nice-terminal',
    });
  });
});

describe('copilot-cli driver event parsing', () => {
  it('detects shell tool progress and success markers', () => {
    const driver = new CopilotCliDriver();
    const shellLine = '● Bash(ant chat send c88sHdaaFG00qV4QVVJ-f --msg "hi")(shell)';
    const successLine = '✅ Command completed';

    expect(driver.detect({ source: 'tmux_output', ts: 1, text: shellLine, raw: shellLine })).toMatchObject({
      class: 'progress',
      payload: { tool: 'Shell' },
    });
    expect(driver.detect({ source: 'tmux_output', ts: 2, text: successLine, raw: successLine })).toMatchObject({
      class: 'progress',
      payload: { signal: 'success' },
    });
  });
});

describe('qwen-cli driver event parsing', () => {
  it('detects busy state and shell success progress', () => {
    const driver = new QwenCliDriver();
    const busyLine = '_ Updating the syntax for reality... (1m 1s  _ 68 tokens  esc to cancel)';
    const successLine = '_ Message sent successfully to the ANT chat channel c88sHdaaFG00qV4QVVJ-f via your terminal.';

    expect(driver.detect({ source: 'tmux_output', ts: 1, text: busyLine, raw: busyLine })).toMatchObject({
      class: 'progress',
    });
    expect(driver.detect({ source: 'tmux_output', ts: 2, text: successLine, raw: successLine })).toMatchObject({
      class: 'progress',
      payload: { signal: 'success' },
    });
  });
});

describe('agent status endpoint state', () => {
  it('caches latest telemetry for polling clients', async () => {
    const sessionId = `status-test-${Date.now()}`;
    const broadcasts: any[] = [];

    init({
      getSession: id => id === sessionId
        ? { id, linked_chat_id: 'linked-chat', meta: JSON.stringify({ agent_driver: 'codex-cli' }) }
        : null,
      postToChat: () => {},
      writeToTerminal: () => {},
      updateMessageMeta: () => {},
      broadcastToChat: () => {},
      broadcastGlobal: msg => broadcasts.push(msg),
    });

    await feed(sessionId, 'gpt-5.5 xhigh · /CascadeProjects/newmodelgvpl · Ready · Context 100% left\n');
    await wait(150);

    expect(broadcasts.some(msg => msg.type === 'agent_status_updated')).toBe(true);
    expect(getPendingEvent(sessionId)).toMatchObject({
      needs_input: false,
      agent_status: {
        state: 'ready',
        model: 'gpt-5.5 xhigh',
        workspace: '/CascadeProjects/newmodelgvpl',
        contextRemainingPct: 100,
      },
    });

    dispose(sessionId);
  });

  it('caches telemetry from unstripped status samples', async () => {
    const sessionId = `status-sample-test-${Date.now()}`;
    const broadcasts: any[] = [];

    init({
      getSession: id => id === sessionId
        ? { id, linked_chat_id: 'linked-chat', meta: JSON.stringify({ agent_driver: 'claude-code' }) }
        : null,
      postToChat: () => {},
      writeToTerminal: () => {},
      updateMessageMeta: () => {},
      broadcastToChat: () => {},
      broadcastGlobal: msg => broadcasts.push(msg),
    });

    await feedStatus(sessionId, [
      'Useful answer line that should remain in the pane',
      'dev@workstation    sample-app main    Opus 4.6 1M context    ctx:94%    5h:81%',
    ].join('\n'));

    expect(broadcasts.some(msg => msg.type === 'agent_status_updated')).toBe(true);
    expect(getPendingEvent(sessionId)).toMatchObject({
      needs_input: false,
      agent_status: {
        state: 'ready',
        model: 'Opus 4.6',
        workspace: 'sample-app',
        branch: 'main',
        contextUsedPct: 94,
      },
    });

    dispose(sessionId);
  });

  it('uses terminal-visible activity as the primary working signal', async () => {
    const sessionId = `terminal-activity-status-test-${Date.now()}`;
    const broadcasts: any[] = [];

    init({
      getSession: id => id === sessionId
        ? { id, linked_chat_id: 'linked-chat', meta: JSON.stringify({ agent_driver: 'codex-cli' }) }
        : null,
      postToChat: () => {},
      writeToTerminal: () => {},
      updateMessageMeta: () => {},
      broadcastToChat: () => {},
      broadcastGlobal: msg => broadcasts.push(msg),
    });

    await feedStatus(sessionId, 'gpt-5.5 xhigh · /repo · Ready · Context 100% left');
    markTerminalActivity(sessionId);
    await feedStatus(sessionId, 'gpt-5.5 xhigh · /repo · Ready · Context 100% left');

    expect(getPendingEvent(sessionId)).toMatchObject({
      needs_input: false,
      agent_status: {
        state: 'busy',
        model: 'gpt-5.5 xhigh',
        workspace: '/repo',
      },
    });
    expect(broadcasts.some(msg =>
      msg.type === 'agent_status_updated' &&
      msg.sessionId === sessionId &&
      msg.status?.state === 'busy'
    )).toBe(true);

    dispose(sessionId);
  });

  it('returns pending event identity and payload for interactive clients', () => {
    const sessionId = `event-status-test-${Date.now()}`;
    const event = {
      class: 'free_text',
      payload: { question: 'Which branch should I use?' },
      text: 'Which branch should I use?',
      ts: 123456,
    } as any;

    trackEvent(sessionId, 'msg-123', 'chat-123', event);

    expect(getPendingEvent(sessionId)).toMatchObject({
      needs_input: true,
      event_id: 'msg-123',
      event_chat_id: 'chat-123',
      event_class: 'free_text',
      event,
      summary: 'Which branch should I use?',
    });

    dispose(sessionId);
  });

  it('marks stale actionable prompts discarded when the agent moves on', async () => {
    const sessionId = `event-moved-on-test-${Date.now()}`;
    const metaUpdates: Array<{ msgId: string; meta: any }> = [];
    const broadcasts: any[] = [];

    init({
      getSession: id => id === sessionId
        ? { id, linked_chat_id: 'linked-chat', meta: JSON.stringify({ agent_driver: 'claude-code' }) }
        : null,
      postToChat: () => {},
      writeToTerminal: () => {},
      updateMessageMeta: (msgId, meta) => metaUpdates.push({ msgId, meta: JSON.parse(meta) }),
      broadcastToChat: (_chatId, msg) => broadcasts.push(msg),
      broadcastGlobal: msg => broadcasts.push(msg),
    });

    trackEvent(sessionId, 'msg-stale', 'chat-stale', {
      class: 'confirmation',
      payload: { question: 'Should I keep waiting?' },
      text: 'Should I keep waiting?',
      ts: 123456,
    } as any);

    await feed(sessionId, '⏺ Running npm test…\n');
    await wait(150);

    expect(metaUpdates).toEqual([{
      msgId: 'msg-stale',
      meta: expect.objectContaining({
        status: 'discarded',
        chosen: 'moved_on',
        discard_reason: 'agent_moved_on',
      }),
    }]);
    expect(broadcasts.some(msg => msg.type === 'session_input_resolved')).toBe(true);
    expect(getPendingEvent(sessionId)).toMatchObject({ needs_input: false });

    dispose(sessionId);
  });

  it('does not track progress events as needs-input prompts', () => {
    const sessionId = `progress-not-pending-test-${Date.now()}`;

    trackEvent(sessionId, 'msg-progress', 'chat-progress', {
      class: 'progress',
      payload: { action: 'Running tests' },
      text: 'Running tests',
      ts: 123456,
    } as any);

    expect(getPendingEvent(sessionId)).toMatchObject({ needs_input: false });

    dispose(sessionId);
  });

  it('discardAllPendingEvents clears pending entries and broadcasts session_input_resolved', () => {
    // Models the Claude hook path (Stop / PreToolUse / PostToolUse): a
    // Notification hook stored a pending event but the agent has now moved on
    // outside of ANT's PTY-driver pipeline, so checkSettled never runs. The
    // hook handler calls discardAllPendingEvents directly to flip the dashboard
    // badge and the AgentEventCard meta back to a clean state.
    const sessionId = `hook-discard-test-${Date.now()}`;
    const metaUpdates: Array<{ msgId: string; meta: any }> = [];
    const broadcasts: any[] = [];

    init({
      getSession: id => id === sessionId
        ? { id, linked_chat_id: 'linked-chat', meta: JSON.stringify({ agent_driver: 'claude-code' }) }
        : null,
      postToChat: () => {},
      writeToTerminal: () => {},
      updateMessageMeta: (msgId, meta) => metaUpdates.push({ msgId, meta: JSON.parse(meta) }),
      broadcastToChat: (_chatId, msg) => broadcasts.push(msg),
      broadcastGlobal: msg => broadcasts.push(msg),
    });

    trackEvent(sessionId, 'msg-hook', 'chat-hook', {
      class: 'permission_request',
      payload: { tool: 'Bash', command: 'rm -rf /tmp/wat' },
      text: 'Permission required for Bash: rm -rf /tmp/wat',
      ts: 123456,
    } as any);

    expect(getPendingEvent(sessionId)).toMatchObject({ needs_input: true });

    discardAllPendingEvents(sessionId, 'turn_ended');

    expect(metaUpdates).toEqual([{
      msgId: 'msg-hook',
      meta: expect.objectContaining({
        status: 'discarded',
        chosen: 'moved_on',
        discard_reason: 'turn_ended',
      }),
    }]);
    expect(broadcasts.some(msg => msg.type === 'session_input_resolved' && msg.sessionId === sessionId)).toBe(true);
    expect(getPendingEvent(sessionId)).toMatchObject({ needs_input: false });

    dispose(sessionId);
  });

  it('discardAllPendingEvents on an unknown session still broadcasts session_input_resolved', () => {
    // Defensive path for hook handlers that fire after the session was already
    // disposed (Stop hook racing with archive). Should still nudge the
    // dashboard so a stale badge clears.
    const broadcasts: any[] = [];
    init({
      getSession: () => null,
      postToChat: () => {},
      writeToTerminal: () => {},
      updateMessageMeta: () => {},
      broadcastToChat: () => {},
      broadcastGlobal: msg => broadcasts.push(msg),
    });

    discardAllPendingEvents('does-not-exist', 'turn_ended');

    expect(broadcasts.some(msg =>
      msg.type === 'session_input_resolved' && msg.sessionId === 'does-not-exist',
    )).toBe(true);
  });
});

describe('Claude Code hook-based status line (ant-status)', () => {
  it('parses the new status-line format with state label, timestamps, and chips', () => {
    const driver = new ClaudeCodeDriver();
    const status = driver.detectStatus([
      '✢ Tinkering… (19s · still thinking)',
      '────── debug-session-state-hooks ──',
      '❯',
      '──────',
      '  sent:10:58:40  resp:10:57:23  edit:10:57:14  |  not-a-real-folder  |  Opus 4.7  |  21m:20%  |  Working',
      '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
      '                                          Remote Control active',
    ]);

    expect(status).toMatchObject({
      state: 'busy', // Working → busy via legacyStateFromLabel
      stateLabel: 'Working',
      activity: 'Tinkering (19s)',
      model: 'Opus 4.7',
      contextUsedPct: 20,
      contextRemainingPct: 80,
      permissionMode: 'bypass permissions on',
      remoteControlActive: true,
    });
    // No state file matches the synthetic folder name → scrape-only
    // timestamps populated from HH:MM:SS local-TZ fallback.
    expect(status?.timestamps?.sentAt).toBeTypeOf('number');
    expect(status?.timestamps?.respAt).toBeTypeOf('number');
    expect(status?.timestamps?.editAt).toBeTypeOf('number');
  });

  it('handles "Menu (question)" suffix and strips parenthetical', () => {
    const driver = new ClaudeCodeDriver();
    const status = driver.detectStatus([
      '  sent:10:58:40  resp:10:57:23  edit:10:57:14  |  not-real  |  Opus 4.7  |  21m:20%  |  Menu (question)',
    ]);
    expect(status?.stateLabel).toBe('Menu');
    expect(status?.state).toBe('thinking'); // Menu → thinking via mapping
  });

  it('handles "Response needed" with whitespace in label', () => {
    const driver = new ClaudeCodeDriver();
    const status = driver.detectStatus([
      '  sent:10:58:40  resp:10:57:23  edit:10:57:14  |  not-real  |  Opus 4.7  |  3h:55%  |  Response needed',
    ]);
    expect(status?.stateLabel).toBe('Response needed');
    expect(status?.state).toBe('thinking');
  });

  it('strips ANSI green codes from the folder name', () => {
    const driver = new ClaudeCodeDriver();
    const status = driver.detectStatus([
      '  sent:10:58:40  resp:10:57:23  edit:10:57:14  |  \x1b[32mnot-real\x1b[0m  |  Opus 4.7  |  21m:20%  |  Waiting',
    ]);
    expect(status?.stateLabel).toBe('Waiting');
    expect(status?.state).toBe('idle');
    expect(status?.contextUsedPct).toBe(20);
  });

  it('handles two-folder form (working | launched-from)', () => {
    const driver = new ClaudeCodeDriver();
    const status = driver.detectStatus([
      '  sent:10:58:40  resp:10:57:23  edit:10:57:14  |  src  |  not-real  |  Opus 4.7  |  21m:20%  |  Working',
    ]);
    expect(status?.stateLabel).toBe('Working');
    expect(status?.contextUsedPct).toBe(20);
  });

  it('falls back gracefully when no new status line is present', () => {
    const driver = new ClaudeCodeDriver();
    const status = driver.detectStatus([
      'dev@host    proj main    Opus 4.6 1M context    ctx:94%    5h:81%',
    ]);
    // Old-format parse still works; no stateLabel since the new line is absent.
    expect(status?.stateLabel).toBeUndefined();
    expect(status?.state).toBe('ready');
    expect(status?.model).toBe('Opus 4.6');
  });
});
