import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ChatComposer controls', () => {
  const source = readFileSync('src/lib/components/ChatComposer.svelte', 'utf8');

  it('does not render the terminal stop symbol in the room composer', () => {
    expect(source).not.toContain('class="stop-action"');
    expect(source).not.toContain('>🛑</button>');
  });

  it('keeps the send button visually separated from secondary composer actions', () => {
    expect(source).toContain('class="send-action-slot"');
    expect(source).toContain('.send-action-slot');
  });
});
