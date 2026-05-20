import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('TerminalChatView terminology', () => {
  const source = readFileSync('src/lib/components/TerminalChatView.svelte', 'utf8');

  it('uses terminal chat as the user-facing label', () => {
    expect(source).toContain('aria-label="Terminal chat"');
    expect(source).toContain('No terminal chat available');
    expect(source).not.toContain('No linked chat room.');
    expect(source).not.toContain('aria-label="Terminal linked-chat-room"');
  });
});
