import { describe, expect, it } from 'vitest';
import { terminalAnchorId, terminalHref } from './terminalDeepLink';

describe('terminal deep links', () => {
  it('uses the terminal list page as the terminal detail surface', () => {
    expect(terminalHref('term-abc123')).toBe('/terminals#term-term-abc123');
  });

  it('keeps punctuation out of the fragment so palette links do not truncate or miss', () => {
    expect(terminalAnchorId('pane/with#unsafe spaces')).toBe('term-pane_2f_with_23_unsafe_20_spaces');
    expect(terminalHref('pane/with#unsafe spaces')).toBe('/terminals#term-pane_2f_with_23_unsafe_20_spaces');
  });
});
