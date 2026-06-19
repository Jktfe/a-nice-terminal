import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import FocusModeModal from './FocusModeModal.svelte';

describe('FocusModeModal', () => {
  it('renders duration choices and optional reason field', () => {
    const { body } = render(FocusModeModal, {
      props: {
        roomId: 'r_focus',
        members: [{ handle: '@codex', displayName: 'Codex', displayColor: '#000', displayIcon: 'C', displayBackgroundStyle: 'transparent', kind: 'agent', joinedAt: '2024-01-01T00:00:00Z' }],
        onClose: () => {},
        onEntered: () => {}
      }
    });

    expect(body).toContain('Set agent focus');
    expect(body).toContain('Codex');
    expect(body).toContain('15m');
    expect(body).toContain('Indefinite');
    expect(body).toContain('Shield this member');
    expect(body).toContain('Solo this member');
    expect(body).toContain('Direct @mentions still break through');
    expect(body).toContain('Focus target');
  });
});
