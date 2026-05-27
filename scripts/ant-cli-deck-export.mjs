/**
 * deck-export — best-effort text extraction from a built Animotion deck
 * to a .pptx file via pptxgenjs.
 *
 * JWPK msg_ocad1i11jg 2026-05-27 ("build everything ASAP"). Honest
 * scope: this captures slide TEXT + structure, not animations,
 * transitions, inline Svelte components, or custom JS. The goal is
 * "agent can hand a .pptx to someone who doesn't have ANT" — full
 * visual fidelity stays with the built HTML at /d/<slug> or the
 * original .svelte source.
 *
 * Extraction strategy:
 * - Read <root>/<slug>/dist/index.html (must exist; user runs
 *   `ant deck build <slug>` first if not)
 * - Find top-level <section> elements (Reveal.js convention used by
 *   Animotion) — each is one slide
 * - For each section, extract:
 *     - First <h1>/<h2>/<h3> as the slide title
 *     - Remaining text content (paragraphs, list items, code blocks)
 *       as body lines
 *     - Image src attributes (NOT embedded — pptx references the URL
 *       only; pptxgenjs would otherwise need the bytes which means
 *       resolving relative URLs against the dist root)
 * - Emit one pptx slide per source section. Layout: title at top, body
 *   as a bullet list below.
 *
 * Output: writes the .pptx to <root>/<slug>/<slug>.pptx alongside
 * the source + dist. Caller can then `ant artefact add --kind other
 * --ref-url file:///path/to/<slug>.pptx` if they want it in a room.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Strip HTML tags from a string. Naive but appropriate for our case —
 * we're not trying to render rich content, just pull out human-readable
 * text. Decodes the five named entities that show up in Animotion
 * output; everything else passes through.
 */
export function stripHtml(raw) {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a Reveal.js / Animotion dist/index.html into a list of slides.
 * Returns an array of { title, body[], imageUrls[] }.
 *
 * Top-level <section> elements that contain nested <section> are
 * "vertical-stack" slides — we flatten them into one entry per inner
 * section so the pptx slide count matches what the deck shows.
 *
 * The parser is regex-based — not a real HTML parser — because we
 * control the input format (Reveal.js output) and the alternative is
 * pulling in cheerio + 4MB of deps. Hostile input is mitigated by
 * the fact that we only render extracted text (no eval, no DOM).
 */
export function parseDeckHtml(html) {
  // Depth-aware scan that finds every matched <section>…</section> pair
  // (handling Reveal.js vertical-stack nesting). A naive non-greedy
  // regex breaks down here because the outer `<section>` consumes the
  // first inner `</section>`, swallowing the first nested slide.
  //
  // Each entry in `allSections` is { inner, hasNested }. We pick the
  // leaves (hasNested=false) so a vertical-stack expands into its
  // constituents rather than the wrapper.
  const openRegex = /<section\b[^>]*>/gi;
  const closeRegex = /<\/section\s*>/gi;
  const tokens = [];
  let m;
  while ((m = openRegex.exec(html)) !== null) {
    tokens.push({ kind: 'open', index: m.index, end: m.index + m[0].length });
  }
  while ((m = closeRegex.exec(html)) !== null) {
    tokens.push({ kind: 'close', index: m.index, end: m.index + m[0].length });
  }
  tokens.sort((a, b) => a.index - b.index);
  const stack = [];
  const allSections = [];
  for (const tok of tokens) {
    if (tok.kind === 'open') {
      stack.push({ contentStart: tok.end, childCount: 0 });
      // Mark the parent (if any) as having a nested child.
      if (stack.length >= 2) stack[stack.length - 2].childCount += 1;
    } else if (stack.length > 0) {
      const opened = stack.pop();
      allSections.push({
        inner: html.slice(opened.contentStart, tok.index),
        hasNested: opened.childCount > 0
      });
    }
  }
  const slides = [];
  for (const { inner, hasNested } of allSections) {
    if (hasNested) continue; // skip wrappers; only emit leaves
    const section = inner;
    const titleMatch = section.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]) : '';
    const bodyParts = [];
    const bodyRegex = /<(p|li|pre|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
    let bodyMatch;
    while ((bodyMatch = bodyRegex.exec(section)) !== null) {
      const text = stripHtml(bodyMatch[2]);
      if (text.length > 0) bodyParts.push(text);
    }
    const imageUrls = [];
    const imgRegex = /<img[^>]+src="([^"]+)"/gi;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(section)) !== null) {
      imageUrls.push(imgMatch[1]);
    }
    slides.push({ title, body: bodyParts, imageUrls });
  }
  return slides;
}

/**
 * Render the parsed slide list into a .pptx via pptxgenjs. Returns the
 * pptxgenjs deck object (so caller can chain .writeFile / .write).
 */
export async function buildPptxFromSlides(slides, deckTitle = 'ANT deck') {
  // Dynamic-import pptxgenjs so unit tests can stub it + so the CLI
  // doesn't load it for non-export verbs.
  const PptxGenJS = (await import('pptxgenjs')).default;
  const deck = new PptxGenJS();
  deck.title = deckTitle;
  deck.layout = 'LAYOUT_16x9';
  for (const slide of slides) {
    const pptxSlide = deck.addSlide();
    if (slide.title) {
      pptxSlide.addText(slide.title, {
        x: 0.5, y: 0.4, w: 9.0, h: 0.8,
        fontSize: 28, bold: true, color: '101418'
      });
    }
    if (slide.body.length > 0) {
      pptxSlide.addText(
        slide.body.map((line) => ({ text: line, options: { bullet: true } })),
        { x: 0.5, y: 1.4, w: 9.0, h: 4.0, fontSize: 16, color: '2a2f3a' }
      );
    }
    if (slide.imageUrls.length > 0) {
      const refs = slide.imageUrls.map((url) => `(image: ${url})`).join('\n');
      pptxSlide.addText(
        `Images referenced (URLs only, not embedded):\n${refs}`,
        { x: 0.5, y: 5.6, w: 9.0, h: 1.3, fontSize: 11, italic: true, color: '6a7280' }
      );
    }
    if (slide.title === '' && slide.body.length === 0 && slide.imageUrls.length === 0) {
      pptxSlide.addText('(empty slide)', {
        x: 0.5, y: 3.0, w: 9.0, h: 1.0, fontSize: 18, italic: true, color: '6a7280'
      });
    }
  }
  return deck;
}

/**
 * End-to-end: read built dist/index.html for the slug, build .pptx,
 * write to <root>/<slug>/<slug>.pptx. Returns the absolute output path.
 */
export async function exportDeckToPptx({ deckDir, slug }) {
  const distIndex = join(deckDir, 'dist', 'index.html');
  if (!existsSync(distIndex)) {
    throw new Error(
      `Built deck not found at ${distIndex}. Run \`ant deck build ${slug}\` first.`
    );
  }
  const html = readFileSync(distIndex, 'utf8');
  const slides = parseDeckHtml(html);
  if (slides.length === 0) {
    throw new Error(
      `No slides could be extracted from ${distIndex}. The deck may not match the Reveal.js / Animotion layout.`
    );
  }
  const deck = await buildPptxFromSlides(slides, slug);
  const outputPath = join(deckDir, `${slug}.pptx`);
  await deck.writeFile({ fileName: outputPath });
  return { outputPath, slideCount: slides.length };
}
