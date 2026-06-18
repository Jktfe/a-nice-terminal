import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync('src/routes/artefacts/[artefactId]/+page.svelte', 'utf8');

describe('/artefacts/[artefactId] page source', () => {
  it('does not make empty deck artefacts default to Univer', () => {
    expect(pageSource).toContain("data.content?.contentFormat === 'univer-json'");
    expect(pageSource).not.toContain("data.content?.contentFormat === 'univer-json' || data.content === null");
  });

  it('never renders the Open-source link from a raw, unsanitised refUrl (XSS regression)', () => {
    // A javascript:/data: artefact.refUrl must not become a clickable anchor.
    // The link must route through the safeRefUrl scheme-allowlist instead.
    expect(pageSource).not.toContain('href={artefact.refUrl}');
    expect(pageSource).toContain('href={safeRefUrl}');
  });
});
