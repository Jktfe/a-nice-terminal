import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync('src/routes/artefacts/[artefactId]/+page.svelte', 'utf8');
const indexSource = readFileSync('src/routes/artefacts/+page.svelte', 'utf8');

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

  it('has a top-level readable artefacts index instead of a dead /artefacts route', () => {
    expect(indexSource).toContain('Room artefacts you can read');
    expect(indexSource).toContain('href={`/artefacts/${encodeURIComponent(artefact.id)}`}');
    expect(indexSource).toContain('href={`/rooms/${encodeURIComponent(artefact.roomId)}`}');
  });
});
