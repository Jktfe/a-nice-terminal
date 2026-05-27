import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync('src/routes/artefacts/[artefactId]/+page.svelte', 'utf8');

describe('/artefacts/[artefactId] page source', () => {
  it('does not make empty deck artefacts default to Univer', () => {
    expect(pageSource).toContain("data.content?.contentFormat === 'univer-json'");
    expect(pageSource).not.toContain("data.content?.contentFormat === 'univer-json' || data.content === null");
  });
});
