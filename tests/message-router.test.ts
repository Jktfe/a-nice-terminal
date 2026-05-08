import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shouldRawForwardLinkedChatMessage } from '../src/lib/server/adapters/linked-chat-adapter.js';
import {
  handlesForMember,
  focusAttentionStatus,
  isWorkingAgentStatus,
  parseMentions,
  resolveRoomFanout,
  shouldDeliverLinkedChatToTerminal,
  sqliteDateTimeAgo,
} from '../src/lib/server/message-router.js';

describe('message router mentions', () => {
  it('returns both room alias and real handle for a member', () => {
    expect(handlesForMember({ alias: '@master-dave', handle: '@masterdave' })).toEqual([
      '@master-dave',
      '@masterdave',
    ]);
  });

  it('matches either a room alias or real handle as a targeted mention', () => {
    const knownHandles = handlesForMember({ alias: '@master-dave', handle: '@masterdave' });

    expect(parseMentions('@master-dave hello', knownHandles)).toEqual({
      targets: ['@master-dave'],
      isAllParticipants: false,
    });
    expect(parseMentions('@masterdave hello', knownHandles)).toEqual({
      targets: ['@masterdave'],
      isAllParticipants: false,
    });
  });

  it('keeps unknown mentions as all-participants broadcasts', () => {
    expect(parseMentions('@master-dave hello', ['@codex'])).toEqual({
      targets: [],
      isAllParticipants: true,
    });
  });
});

describe('focus attention state', () => {
  it('treats focused members as active until their TTL expires', () => {
    expect(focusAttentionStatus({ attention_state: 'available' }, 100)).toBe('available');
    expect(focusAttentionStatus({ attention_state: 'focus', attention_expires_at: 120 }, 100)).toBe('active');
    expect(focusAttentionStatus({ attention_state: 'focus', attention_expires_at: 100 }, 100)).toBe('expired');
  });

  it('formats bypass windows for SQLite datetime comparisons', () => {
    const now = Date.parse('2026-04-28T18:40:00.000Z');
    expect(sqliteDateTimeAgo(10 * 60 * 1000, now)).toBe('2026-04-28 18:30:00');
  });
});

describe('linked chat source markers', () => {
  it('raw-forwards desktop linked-chat sends but skips terminal-page history writes', () => {
    expect(shouldRawForwardLinkedChatMessage({
      role: 'user',
      meta: '{}',
    }, true)).toBe(true);

    expect(shouldRawForwardLinkedChatMessage({
      role: 'user',
      meta: JSON.stringify({ source: 'terminal_direct' }),
    }, true)).toBe(false);
  });

  it('allows coordinator terminals to type into another terminal linked chat', () => {
    expect(shouldDeliverLinkedChatToTerminal('target-terminal', 'coordinator-terminal')).toBe(true);
    expect(shouldDeliverLinkedChatToTerminal('target-terminal', 'target-terminal')).toBe(false);
  });
});

describe('room fan-out scope', () => {
  const handles = ['@claude', '@gemini', '@codex'];

  it('routes terminal acknowledgements only to idle/ready terminals', () => {
    expect(resolveRoomFanout('on it', handles, 'terminal')).toEqual({
      targets: [],
      isAllParticipants: true,
      shouldFanOutToTerminals: true,
      protectWorkingTerminals: true,
    });
  });

  it('routes terminal-originated active mentions to the named terminal', () => {
    expect(resolveRoomFanout('@gemini can you help', handles, 'terminal')).toEqual({
      targets: ['@gemini'],
      isAllParticipants: false,
      shouldFanOutToTerminals: true,
      protectWorkingTerminals: false,
    });
  });

  it('lets terminal-originated @everyone fan out to all terminals', () => {
    expect(resolveRoomFanout('@everyone status update', handles, 'terminal')).toEqual({
      targets: [],
      isAllParticipants: true,
      shouldFanOutToTerminals: true,
      protectWorkingTerminals: false,
    });
  });

  it('does not treat terminal-originated unknown mentions as broadcasts', () => {
    expect(resolveRoomFanout('@unknown on it', handles, 'terminal')).toEqual({
      targets: [],
      isAllParticipants: true,
      shouldFanOutToTerminals: false,
      protectWorkingTerminals: false,
    });
  });

  it('preserves human broadcast behaviour', () => {
    expect(resolveRoomFanout('can someone check this', handles, null)).toEqual({
      targets: [],
      isAllParticipants: true,
      shouldFanOutToTerminals: true,
      protectWorkingTerminals: false,
    });
  });

  it('only protects fresh busy or thinking status from plain updates', () => {
    const now = 1_000_000;

    expect(isWorkingAgentStatus({
      state: 'busy',
      detectedAt: now - 10_000,
    }, now)).toBe(true);

    expect(isWorkingAgentStatus({
      state: 'thinking',
      detectedAt: now - 10_000,
    }, now)).toBe(true);

    expect(isWorkingAgentStatus({
      state: 'ready',
      detectedAt: now - 10_000,
    }, now)).toBe(false);

    expect(isWorkingAgentStatus({
      state: 'busy',
      detectedAt: now - 60_000,
    }, now)).toBe(false);
  });
});

describe('agent-facing context loaders', () => {
  it('routes CLI and MCP history reads through bounded agent context', () => {
    const cliSource = readFileSync(resolve(import.meta.dirname, '../cli/commands/chat.ts'), 'utf8');
    const mcpSource = readFileSync(resolve(import.meta.dirname, '../src/lib/server/mcp-handler.ts'), 'utf8');
    const ptySource = readFileSync(resolve(import.meta.dirname, '../src/lib/server/adapters/pty-injection-adapter.ts'), 'utf8');
    const promptBridgeSource = readFileSync(resolve(import.meta.dirname, '../src/lib/server/prompt-bridge.ts'), 'utf8');

    expect(cliSource).toContain('agent_context=1');
    expect(cliSource).toContain('flags.full || flags.all');
    expect(mcpSource).toContain('loadMessagesForAgentContext(ctx.roomId, { since, limit })');
    expect(ptySource).toContain('loadMessagesForAgentContext(roomId, { limit: maxMessages + 1 })');
    expect(ptySource).toContain('bounded room context:');
    expect(promptBridgeSource).not.toMatch(/listMessages|getMessagesSince|getLatestMessages/);
  });
});
