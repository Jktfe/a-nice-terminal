import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TerminalHeader from './TerminalHeader.svelte';

describe('TerminalHeader', () => {
  it('renders a dedicated stop-sign interrupt action when provided', () => {
    const { body } = render(TerminalHeader, {
      props: {
        userName: 'Codex terminal',
        viewMode: 'raw',
        onViewChange: () => {},
        onInterrupt: () => {}
      }
    });

    expect(body).toContain('Interrupt terminal');
    expect(body).toContain('🛑');
    expect(body).not.toContain('Context break');
  });
});
