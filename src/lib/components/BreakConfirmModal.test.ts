import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import BreakConfirmModal from './BreakConfirmModal.svelte';

describe('BreakConfirmModal', () => {
  it('renders title, reason field and action buttons', () => {
    const { body } = render(BreakConfirmModal, {
      props: {
        isOpen: true,
        reasonTyped: '',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        onReasonInput: vi.fn()
      }
    });

    expect(body).toContain('Post a context break?');
    expect(body).toContain('Reason (optional)');
    expect(body).toContain('Cancel');
    expect(body).toContain('Post break');
  });

  it('shows reason value when provided', () => {
    const { body } = render(BreakConfirmModal, {
      props: {
        isOpen: true,
        reasonTyped: 'starting sprint 3',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        onReasonInput: vi.fn()
      }
    });

    // The input value is set via the value prop
    expect(body).toContain('starting sprint 3');
  });
});
