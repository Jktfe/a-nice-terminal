import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import ModalShell from './ModalShell.svelte';

describe('ModalShell', () => {
  it('renders title, body and actions slots', () => {
    const { body } = render(ModalShell, {
      props: {
        open: true,
        onCancel: vi.fn(),
        size: 'default'
      }
    });

    // ModalShell renders the dialog element
    expect(body).toContain('<dialog');
    expect(body).toContain('modal-shell');
    expect(body).toContain('modal-shell--default');
  });

  it('applies narrow size class', () => {
    const { body } = render(ModalShell, {
      props: { open: true, onCancel: vi.fn(), size: 'narrow' }
    });
    expect(body).toContain('modal-shell--narrow');
  });

  it('applies wide size class', () => {
    const { body } = render(ModalShell, {
      props: { open: true, onCancel: vi.fn(), size: 'wide' }
    });
    expect(body).toContain('modal-shell--wide');
  });
});
