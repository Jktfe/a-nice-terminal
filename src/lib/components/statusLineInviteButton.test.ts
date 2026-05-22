import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AgentStatusFooter status-line invite affordance', () => {
  it('calls the room-scoped status-line invite endpoint from a visible action', () => {
    const source = readFileSync('src/lib/components/AgentStatusFooter.svelte', 'utf8');

    expect(source).toContain('/status-line-invite');
    expect(source).toContain('broadcastStatusLineInvite');
    expect(source).toContain('Invite status line');
  });
});
