import { describe, expect, it } from 'vitest';
import { deckThemeForSubstrate, externalDeckSourceFromTheme } from './externalDeckSubstrate';

describe('externalDeckSubstrate helpers', () => {
  it('encodes and decodes Animotion deck slugs as the primary deck substrate', () => {
    const theme = deckThemeForSubstrate('animotion', 'state-of-play-2026-05-27');

    expect(theme).toBe('animotion:state-of-play-2026-05-27');
    expect(externalDeckSourceFromTheme(theme)).toEqual({
      substrate: 'animotion',
      slug: 'state-of-play-2026-05-27',
      label: 'Animotion',
      path: '/d/state-of-play-2026-05-27'
    });
  });

  it('keeps Open-Slide as a compatibility substrate for existing built decks', () => {
    expect(externalDeckSourceFromTheme('open-slide:legacy-board-pack')).toMatchObject({
      substrate: 'open-slide',
      slug: 'legacy-board-pack',
      label: 'Open-Slide'
    });
  });

  it('rejects path-like slugs before they reach the /d proxy', () => {
    expect(() => deckThemeForSubstrate('animotion', '../secrets')).toThrow('Invalid deck slug.');
    expect(externalDeckSourceFromTheme('animotion:../secrets')).toBeNull();
  });
});
