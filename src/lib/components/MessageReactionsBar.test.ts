import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import MessageReactionsBar from './MessageReactionsBar.svelte';
import type { MessageReaction } from '$lib/server/messageReactionStore';

function reaction(reactorHandle: string, emoji = '🧏‍♂️'): MessageReaction {
  return {
    messageId: 'msg_1',
    reactorHandle,
    emoji,
    reactedAt: '2026-06-12T12:00:00.000Z'
  };
}

describe('MessageReactionsBar', () => {
  it('shows a single heard/read summary chip with count and respondent tooltip', () => {
    const { body } = render(MessageReactionsBar, {
      props: {
        roomId: 'room_1',
        messageId: 'msg_1',
        asHandle: '@viewer',
        initialReactions: [reaction('@rawls'), reaction('@godel'), reaction('@mencius', '👍')]
      }
    });

    expect(body).toContain('heard-read-summary');
    expect(body).toContain('🧏‍♂️');
    expect(body).toContain('summary-count');
    expect(body).toContain('>2</span>');
    expect(body).toContain('title="Heard / read — @rawls, @godel"');
    expect(body).toContain('aria-label="Heard / read: 2 heard (@rawls, @godel). Click to toggle yours."');
    expect(body).toContain('title="Good — @mencius"');
  });
});
