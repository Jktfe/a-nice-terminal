export type DeckSubstrate = 'animotion' | 'open-slide';

export type ExternalDeckSource = {
  substrate: DeckSubstrate;
  slug: string;
  label: string;
  path: string;
};

const SAFE_DECK_SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const SUBSTRATE_LABELS: Record<DeckSubstrate, string> = {
  animotion: 'Animotion',
  'open-slide': 'Open-Slide'
};

export function isSafeExternalDeckSlug(value: string): boolean {
  return SAFE_DECK_SLUG_RE.test(value) && value !== '.' && value !== '..';
}

export function deckThemeForSubstrate(substrate: DeckSubstrate, slug: string): string {
  if (!isSafeExternalDeckSlug(slug)) {
    throw new Error('Invalid deck slug.');
  }
  return `${substrate}:${slug}`;
}

export function externalDeckSourceFromTheme(theme: string | null | undefined): ExternalDeckSource | null {
  if (!theme) return null;
  const separatorIndex = theme.indexOf(':');
  if (separatorIndex <= 0) return null;
  const substrate = theme.slice(0, separatorIndex);
  const slug = theme.slice(separatorIndex + 1);
  if (substrate !== 'animotion' && substrate !== 'open-slide') return null;
  if (!isSafeExternalDeckSlug(slug)) return null;
  return {
    substrate,
    slug,
    label: SUBSTRATE_LABELS[substrate],
    path: `/d/${slug}`
  };
}
