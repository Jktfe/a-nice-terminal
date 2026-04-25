import { describe, it, expect } from 'vitest';
import { ClaudeCodeDriver } from '../src/drivers/claude-code/driver.js';
import { CodexCliDriver } from '../src/drivers/codex-cli/driver.js';
import { GeminiCliDriver } from '../src/drivers/gemini-cli/driver.js';
import { dispose, feed, getPendingEvent, init } from '../src/lib/server/agent-event-bus.js';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('agent status line parsing', () => {
  it('parses Claude model, context, rate limit, workspace, and branch', () => {
    const driver = new ClaudeCodeDriver();
    const status = driver.detectStatus([
      'jamesking@Jamess-Mac-mini    manorfarmios main    Opus 4.6 1M context    ctx:94%    5h:81%',
    ]);

    expect(status).toMatchObject({
      state: 'ready',
      model: 'Opus 4.6',
      contextUsedPct: 94,
      contextRemainingPct: 6,
      rateLimitPct: 81,
      rateLimitWindow: '5h',
      workspace: 'manorfarmios',
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
});
