import { describe, expect, it } from 'vitest';
import { autoLinkedTerminalId, buildAutoLinkedChatMeta, isAutoLinkedChatForTerminal } from '../src/lib/server/linked-chat.js';

describe('linked chat metadata', () => {
  it('recognises private auto-linked terminal companions', () => {
    const meta = buildAutoLinkedChatMeta('terminal-123');

    expect(isAutoLinkedChatForTerminal(meta, 'terminal-123')).toBe(true);
    expect(isAutoLinkedChatForTerminal(JSON.stringify(meta), 'terminal-123')).toBe(true);
    expect(autoLinkedTerminalId(meta)).toBe('terminal-123');
  });

  it('does not treat ordinary chatrooms as auto-linked companions', () => {
    expect(isAutoLinkedChatForTerminal({}, 'terminal-123')).toBe(false);
    expect(autoLinkedTerminalId({ purpose: 'group-room' })).toBeNull();
  });
});
