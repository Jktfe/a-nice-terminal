// B3 of main-app-improvements-2026-05-10 — focused tests for the
// trusted-mode auto-reload script the deck proxy injects. The
// chokidar watcher and broadcast pipeline are integration concerns;
// here we lock the injected payload so regressions in the script
// shape (wrong URL, missing visibility guard, no in-flight gate)
// are caught at unit-test speed.

import { describe, expect, it } from 'vitest';
import { injectTrustedReloader } from '../src/lib/server/decks.js';

describe('injectTrustedReloader', () => {
  it('appends the script immediately before the closing body tag', () => {
    const html = '<html><body><h1>Deck</h1></body></html>';
    const out = injectTrustedReloader('demo', html);
    expect(out).toContain('<script data-ant-deck-reloader>');
    expect(out.indexOf('<script data-ant-deck-reloader>')).toBeGreaterThan(out.indexOf('<h1>'));
    expect(out.indexOf('</script>')).toBeLessThan(out.indexOf('</body>'));
  });

  it('points the fetch at the slug-scoped deck API endpoint', () => {
    const out = injectTrustedReloader('antios-improvements-2026-05-10', '<body></body>');
    expect(out).toContain('"/api/decks/antios-improvements-2026-05-10"');
  });

  it('uri-encodes slugs with special characters', () => {
    const out = injectTrustedReloader('deck/with spaces', '<body></body>');
    expect(out).toContain('"/api/decks/deck%2Fwith%20spaces"');
  });

  it('guards against concurrent polls and visibility-hidden tabs', () => {
    const out = injectTrustedReloader('demo', '<body></body>');
    expect(out).toContain('inFlight');
    expect(out).toContain('document.hidden');
  });

  it('reloads only when updated_at strictly increases (no reload on first sample)', () => {
    const out = injectTrustedReloader('demo', '<body></body>');
    // First-sample no-reload pattern: lastTs starts at 0 and the
    // first non-zero ts is captured without triggering location.reload.
    expect(out).toContain('lastTs===0');
    expect(out).toContain('ts>lastTs');
    expect(out).toContain('location.reload');
  });

  it('falls back to appending at end when no body close tag is present', () => {
    const out = injectTrustedReloader('demo', '<h1>raw</h1>');
    expect(out.startsWith('<h1>raw</h1>')).toBe(true);
    expect(out).toContain('<script data-ant-deck-reloader>');
  });
});
