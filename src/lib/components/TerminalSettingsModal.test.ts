import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TerminalSettingsModal from './TerminalSettingsModal.svelte';

describe('TerminalSettingsModal', () => {
  it('renders the terminal ownership, delivery, persistence, and kill controls', () => {
    const { body } = render(TerminalSettingsModal, {
      props: {
        terminalId: 'term_1',
        terminalName: 'Codex desk',
        terminalHandle: '@codex',
        roomAgentHandles: ['@codex', '@claude'],
        open: true,
        onClose: () => {}
      }
    });

    expect(body).toContain('Co-owners');
    expect(body).toContain('Write access');
    expect(body).toContain('Output persistence');
    expect(body).toContain('Default kill action');
    expect(body).toContain('Message delivery');
    expect(body).toContain('Handle only');
  });

  it('sends write access as canonical read_write grants, not stale timestamp grants', () => {
    const source = readFileSync('src/lib/components/TerminalSettingsModal.svelte', 'utf8');

    expect(source).toContain("mode: 'read_write'");
    expect(source).not.toContain('grantedAtMs');
  });
});
