import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every browser-facing page route should set a distinct <title> via
// <svelte:head> (SimplePageShell's `title` prop is the visual heading only,
// it does NOT set the browser tab title). These three pages were shipping
// with no <title> at all (generic/empty browser tab); regression-guard them.
describe('page <title> coverage', () => {
  const cases: Array<[string, string]> = [
    ['src/routes/ledger/+page.svelte', 'Ledger | ANT vNext'],
    ['src/routes/manual/suggestions/+page.svelte', 'Suggestions | ANT vNext'],
    ['src/routes/manual/v2/+page.svelte', 'Screens canvas | ANT vNext']
  ];

  for (const [file, title] of cases) {
    it(`${file} sets a browser title`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain('<svelte:head>');
      expect(src).toContain(`<title>${title}</title>`);
    });
  }
});
