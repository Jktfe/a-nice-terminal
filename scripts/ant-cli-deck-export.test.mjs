import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  stripHtml,
  parseDeckHtml,
  buildPptxFromSlides,
  exportDeckToPptx
} from './ant-cli-deck-export.mjs';

let scratchDir = '';

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'ant-deck-export-test-'));
});

afterEach(() => {
  try { rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('stripHtml', () => {
  it('removes tags + decodes the five named entities', () => {
    expect(stripHtml('<p>Hello &amp; <b>world</b></p>')).toBe('Hello & world');
    expect(stripHtml('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('<script>alert(1)</script>');
    expect(stripHtml('&quot;quoted&quot;')).toBe('"quoted"');
    expect(stripHtml('it&#39;s')).toBe("it's");
  });
  it('collapses whitespace runs', () => {
    expect(stripHtml('<p>line one</p>\n\n   <p>line two</p>')).toBe('line one line two');
  });
  it('returns empty string for tag-only input', () => {
    expect(stripHtml('<div></div>')).toBe('');
  });
});

describe('parseDeckHtml', () => {
  it('extracts a flat single-slide deck — title + body', () => {
    const html = `
      <html><body>
        <div class="slides">
          <section>
            <h1>Title One</h1>
            <p>Body line A</p>
            <p>Body line B</p>
          </section>
        </div>
      </body></html>`;
    const slides = parseDeckHtml(html);
    expect(slides).toHaveLength(1);
    expect(slides[0].title).toBe('Title One');
    expect(slides[0].body).toEqual(['Body line A', 'Body line B']);
    expect(slides[0].imageUrls).toEqual([]);
  });

  it('flattens vertical-stack sections so the slide count matches what the deck shows', () => {
    const html = `
      <section>
        <section>
          <h1>Stack Slide 1</h1>
          <p>p1</p>
        </section>
        <section>
          <h2>Stack Slide 2</h2>
          <p>p2</p>
        </section>
      </section>
      <section>
        <h1>Flat Slide</h1>
        <p>p3</p>
      </section>`;
    const slides = parseDeckHtml(html);
    expect(slides).toHaveLength(3);
    expect(slides.map((s) => s.title)).toEqual(['Stack Slide 1', 'Stack Slide 2', 'Flat Slide']);
  });

  it('extracts <li> + <pre> + <blockquote> as body lines (in order)', () => {
    const html = `
      <section>
        <h1>Mixed Body</h1>
        <ul><li>bullet one</li><li>bullet two</li></ul>
        <pre><code>code line</code></pre>
        <blockquote>quoted line</blockquote>
      </section>`;
    const slides = parseDeckHtml(html);
    expect(slides[0].body).toEqual([
      'bullet one', 'bullet two', 'code line', 'quoted line'
    ]);
  });

  it('captures image src URLs in order', () => {
    const html = `
      <section>
        <h1>Images</h1>
        <img src="/d/demo/assets/hero.png" alt="hero" />
        <p>Some text.</p>
        <img src="https://cdn.example.com/chart.svg" alt="chart" />
      </section>`;
    const slides = parseDeckHtml(html);
    expect(slides[0].imageUrls).toEqual([
      '/d/demo/assets/hero.png',
      'https://cdn.example.com/chart.svg'
    ]);
  });

  it('produces an empty slide entry for a section with no extractable content', () => {
    const html = `
      <section>
        <div class="decoration"></div>
      </section>`;
    const slides = parseDeckHtml(html);
    expect(slides).toHaveLength(1);
    expect(slides[0].title).toBe('');
    expect(slides[0].body).toEqual([]);
    expect(slides[0].imageUrls).toEqual([]);
  });

  it('returns an empty list when there are no <section> elements at all', () => {
    expect(parseDeckHtml('<html><body><p>no sections</p></body></html>')).toEqual([]);
  });
});

describe('buildPptxFromSlides', () => {
  it('produces a pptxgenjs deck object with one slide per input', async () => {
    const slides = [
      { title: 'A', body: ['line 1'], imageUrls: [] },
      { title: 'B', body: ['line 2', 'line 3'], imageUrls: ['/d/x/a.png'] },
      { title: '', body: [], imageUrls: [] }
    ];
    const deck = await buildPptxFromSlides(slides, 'unit-test-deck');
    expect(deck).toBeDefined();
    // pptxgenjs exposes a `slides` array on the instance
    expect(Array.isArray(deck.slides)).toBe(true);
    expect(deck.slides.length).toBe(3);
    expect(deck.title).toBe('unit-test-deck');
  });
});

describe('exportDeckToPptx (end-to-end with a stub deck)', () => {
  function writeStubDeck(slug, html) {
    const deckDir = join(scratchDir, slug);
    mkdirSync(join(deckDir, 'dist'), { recursive: true });
    writeFileSync(join(deckDir, 'dist', 'index.html'), html, 'utf8');
    return deckDir;
  }

  it('writes a .pptx alongside the dist/ folder', async () => {
    const deckDir = writeStubDeck('my-deck', `
      <html><body>
        <section><h1>Slide 1</h1><p>p1</p></section>
        <section><h2>Slide 2</h2><p>p2</p></section>
      </body></html>`);
    const result = await exportDeckToPptx({ deckDir, slug: 'my-deck' });
    expect(result.slideCount).toBe(2);
    expect(result.outputPath).toBe(join(deckDir, 'my-deck.pptx'));
    expect(existsSync(result.outputPath)).toBe(true);
    // .pptx is a zip — non-trivial file size on success.
    expect(statSync(result.outputPath).size).toBeGreaterThan(1000);
  });

  it('throws a clear error when dist/index.html is missing', async () => {
    const deckDir = join(scratchDir, 'no-build');
    mkdirSync(deckDir, { recursive: true });
    await expect(exportDeckToPptx({ deckDir, slug: 'no-build' }))
      .rejects.toThrow(/Built deck not found.*ant deck build no-build/);
  });

  it('throws when the dist has no <section> elements to extract', async () => {
    const deckDir = writeStubDeck('empty-deck',
      '<html><body><p>no sections</p></body></html>');
    await expect(exportDeckToPptx({ deckDir, slug: 'empty-deck' }))
      .rejects.toThrow(/No slides could be extracted/);
  });
});
