import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import StageFeedbackPanel from './StageFeedbackPanel.svelte';

const baseProps = {
  pauseSnapshot: null,
  feedbackText: '',
  pasteContext: '',
  feedbackSubmitting: false,
  onSubmit: vi.fn(),
  onClear: vi.fn()
};

describe('StageFeedbackPanel proposal link safety', () => {
  it('renders safe proposal refs as links', () => {
    const { body } = render(StageFeedbackPanel, {
      props: {
        ...baseProps,
        feedbackNotice: {
          kind: 'ok',
          text: 'Feedback received.',
          ref: '/artefacts/stage-proposal'
        }
      }
    });

    expect(body).toContain('href="/artefacts/stage-proposal"');
    expect(body).toContain('Open proposal');
  });

  it('renders unsafe proposal refs as text, not executable links', () => {
    const { body } = render(StageFeedbackPanel, {
      props: {
        ...baseProps,
        feedbackNotice: {
          kind: 'ok',
          text: 'Feedback received.',
          ref: 'javascript:alert(1)'
        }
      }
    });

    expect(body).toContain('javascript:alert(1)');
    expect(body).toContain('title="Not a safe URL"');
    expect(body).not.toContain('href="javascript:alert(1)"');
  });
});
