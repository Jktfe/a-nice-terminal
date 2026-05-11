// B2 of main-app-improvements-2026-05-10 — banner-injection logic for
// the Safe-mode CSP path. We isolate the pure HTML-rewrite helper so a
// regression in the banner shape (missing form action, inline scripts
// sneaking back in, malformed body match) is caught at unit-test speed.

import { describe, expect, it } from 'vitest';
import { injectSafeBanner } from '../src/lib/server/decks.js';

describe('injectSafeBanner', () => {
  it('injects the banner immediately after the body opening tag', () => {
    const html = '<html><head></head><body class="dark"><h1>Deck</h1></body></html>';
    const out = injectSafeBanner('demo', html);
    const idx = out.indexOf('data-ant-safe-banner');
    const bodyIdx = out.indexOf('<body class="dark">');
    expect(idx).toBeGreaterThan(bodyIdx);
    expect(idx - bodyIdx).toBeLessThan(50);
  });

  it('points the trust form at the slug-scoped trust endpoint', () => {
    const out = injectSafeBanner('antios-improvements-2026-05-10', '<body></body>');
    expect(out).toContain('action="/api/decks/antios-improvements-2026-05-10/trust"');
    expect(out).toContain('name="mode"');
    expect(out).toContain('value="trusted"');
  });

  it('uri-encodes slugs with special characters', () => {
    const out = injectSafeBanner('deck/with spaces', '<body></body>');
    expect(out).toContain('action="/api/decks/deck%2Fwith%20spaces/trust"');
  });

  it('contains no inline script, no event handlers, no remote URLs', () => {
    const out = injectSafeBanner('demo', '<body></body>');
    const banner = out.slice(out.indexOf('data-ant-safe-banner'));
    expect(banner).not.toMatch(/<script/i);
    expect(banner).not.toMatch(/\bonclick=/i);
    expect(banner).not.toMatch(/\bonload=/i);
    expect(banner).not.toMatch(/https?:\/\//i);
  });

  it('falls back to prepending the banner when no body tag is present', () => {
    const out = injectSafeBanner('demo', '<h1>raw</h1>');
    expect(out.startsWith('<div data-ant-safe-banner')).toBe(true);
    expect(out).toContain('<h1>raw</h1>');
  });
});
