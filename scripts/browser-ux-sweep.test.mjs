import { describe, expect, it } from 'vitest';
import {
  CliInputError,
  buildConfigFromArgs,
  chooseSafeNavigationCandidates,
  explainNavigationSafety,
  isSafeNavigationCandidate,
  makeRouteSlug,
  normalizeRouteInput
} from './browser-ux-sweep.mjs';

const baseUrl = 'http://127.0.0.1:6174';

function link(overrides = {}) {
  return {
    tagName: 'a',
    role: '',
    text: 'Rooms',
    ariaLabel: '',
    title: '',
    href: `${baseUrl}/rooms`,
    target: '',
    download: false,
    disabled: false,
    visible: true,
    navAncestor: true,
    ...overrides
  };
}

describe('browser-ux-sweep args', () => {
  it('requires a caller-specified artifact directory', () => {
    expect(() => buildConfigFromArgs([], {}, '/tmp')).toThrow(CliInputError);
  });

  it('normalizes same-origin routes and bounds the default route list', () => {
    const config = buildConfigFromArgs(
      [
        '--artifact-dir', 'artifacts/browser-sweep',
        '--base-url', baseUrl,
        '--route', '/rooms',
        '--route', `${baseUrl}/plans?view=active`,
        '--max-routes', '1'
      ],
      {},
      '/work'
    );
    expect(config.artifactDir).toBe('/work/artifacts/browser-sweep');
    expect(config.routes).toEqual(['/rooms']);
  });

  it('rejects routes outside the base origin', () => {
    expect(() => normalizeRouteInput('https://example.com/', baseUrl)).toThrow(CliInputError);
  });

  it('makes stable screenshot slugs', () => {
    expect(makeRouteSlug('/discover/visuals?mode=grid#top')).toBe('discover-visuals-mode-grid-top');
    expect(makeRouteSlug('/')).toBe('root');
  });
});

describe('browser-ux-sweep safe click rules', () => {
  it('allows visible same-origin navigation links', () => {
    expect(isSafeNavigationCandidate(link(), { baseUrl, currentUrl: `${baseUrl}/` })).toBe(true);
  });

  it('blocks buttons and form controls even when the label looks benign', () => {
    const decision = explainNavigationSafety(
      link({ tagName: 'button', role: 'button', href: '', text: 'Open' }),
      { baseUrl }
    );
    expect(decision.safe).toBe(false);
    expect(decision.reason).toBe('not a link');
  });

  it('blocks destructive or state-changing labels and paths', () => {
    const dangerous = [
      link({ text: 'Delete room', href: `${baseUrl}/rooms/abc/delete` }),
      link({ text: 'Send message', href: `${baseUrl}/rooms/abc` }),
      link({ text: 'Approve access', href: `${baseUrl}/asks/1/approve` }),
      link({ text: 'Kill terminal', href: `${baseUrl}/terminals/1/kill` }),
      link({ text: 'Vote done', href: `${baseUrl}/rooms/abc/vote` })
    ];

    for (const element of dangerous) {
      expect(isSafeNavigationCandidate(element, { baseUrl, currentUrl: `${baseUrl}/rooms` })).toBe(false);
    }
  });

  it('blocks external, api, hidden, disabled, download, and new-tab links', () => {
    const blocked = [
      link({ href: 'https://example.com/rooms' }),
      link({ href: `${baseUrl}/api/rooms` }),
      link({ visible: false }),
      link({ disabled: true }),
      link({ download: true }),
      link({ target: '_blank' })
    ];

    for (const element of blocked) {
      expect(isSafeNavigationCandidate(element, { baseUrl, currentUrl: `${baseUrl}/rooms` })).toBe(false);
    }
  });

  it('deduplicates and limits safe candidates', () => {
    const candidates = chooseSafeNavigationCandidates(
      [
        link({ text: 'Rooms', href: `${baseUrl}/rooms` }),
        link({ text: 'Rooms', href: `${baseUrl}/rooms` }),
        link({ text: 'Plans', href: `${baseUrl}/plans` })
      ],
      { baseUrl, currentUrl: `${baseUrl}/`, maxClicksPerRoute: 1 }
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].href).toBe(`${baseUrl}/rooms`);
  });

  it('returns no candidates when safe clicks are disabled', () => {
    const candidates = chooseSafeNavigationCandidates(
      [link({ text: 'Rooms', href: `${baseUrl}/rooms` })],
      { baseUrl, currentUrl: `${baseUrl}/`, maxClicksPerRoute: 0 }
    );
    expect(candidates).toEqual([]);
  });
});
