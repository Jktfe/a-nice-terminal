type UniverKind = 'deck' | 'doc';

type UniverRenderInput = {
  title: string;
  kind: UniverKind;
  contentBody: string;
};

type DeckSlide = {
  title: string;
  lines: string[];
};

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function objectValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function stringValue(value: unknown, key: string): string | null {
  const raw = objectValue(value, key);
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function cleanText(raw: string): string {
  return raw
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function addUnique(lines: string[], seen: Set<string>, raw: string): void {
  const cleaned = cleanText(raw);
  if (cleaned.length === 0) return;
  if (/^[a-z0-9_-]{8,}$/i.test(cleaned)) return;
  if (seen.has(cleaned)) return;
  seen.add(cleaned);
  lines.push(cleaned);
}

function collectText(value: unknown, lines: string[], seen = new Set<string>(), depth = 0): void {
  if (depth > 8 || value == null) return;
  if (typeof value === 'string') {
    addUnique(lines, seen, value);
    return;
  }
  if (typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, lines, seen, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (['id', 'unitId', 'subUnitId', 'pageId', 'shapeId'].includes(key)) continue;
    collectText(child, lines, seen, depth + 1);
  }
}

function orderedPageEntries(snapshot: unknown): Array<[string, unknown]> {
  const pages = objectValue(snapshot, 'pages');
  if (!pages || typeof pages !== 'object' || Array.isArray(pages)) return [];
  const pageMap = pages as Record<string, unknown>;
  const order = objectValue(snapshot, 'pageOrder');
  if (Array.isArray(order)) {
    return order
      .filter((id): id is string => typeof id === 'string' && pageMap[id] !== undefined)
      .map((id) => [id, pageMap[id]]);
  }
  return Object.entries(pageMap);
}

function deckSlidesFromSnapshot(snapshot: unknown): DeckSlide[] {
  const explicitSlides = objectValue(snapshot, 'slides');
  if (Array.isArray(explicitSlides)) {
    return explicitSlides.map((slide, index) => {
      const lines: string[] = [];
      collectText(slide, lines);
      const title = stringValue(slide, 'title') ?? stringValue(slide, 'name') ?? `Slide ${index + 1}`;
      return { title, lines: lines.filter((line) => line !== title) };
    });
  }

  const pages = orderedPageEntries(snapshot);
  return pages.map(([, page], index) => {
    const lines: string[] = [];
    const pageElements = objectValue(page, 'pageElements') ?? objectValue(page, 'elements') ?? page;
    collectText(pageElements, lines);
    const title = stringValue(page, 'title') ?? stringValue(page, 'name') ?? lines[0] ?? `Slide ${index + 1}`;
    return { title, lines: lines.filter((line) => line !== title) };
  });
}

function docParagraphsFromSnapshot(snapshot: unknown): string[] {
  const dataStream = objectValue(objectValue(snapshot, 'body'), 'dataStream');
  if (typeof dataStream === 'string') {
    return cleanText(dataStream)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const lines: string[] = [];
  collectText(snapshot, lines);
  return lines;
}

function renderDeckBody(snapshot: unknown): string {
  const slides = deckSlidesFromSnapshot(snapshot);
  if (slides.length === 0) {
    return `<section class="univer-empty"><p>No slide pages were found in this Univer snapshot.</p></section>`;
  }
  return slides
    .map((slide, index) => `
      <section class="univer-slide" aria-label="Slide ${index + 1} of ${slides.length}">
        <div class="slide-kicker">Slide ${index + 1} / ${slides.length}</div>
        <h2>${escapeHtml(slide.title)}</h2>
        ${slide.lines.length > 0
          ? `<ul>${slide.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
          : '<p class="muted">No text objects found on this slide.</p>'}
      </section>
    `)
    .join('\n');
}

function renderDocBody(snapshot: unknown): string {
  const paragraphs = docParagraphsFromSnapshot(snapshot);
  if (paragraphs.length === 0) {
    return `<section class="univer-empty"><p>No document text was found in this Univer snapshot.</p></section>`;
  }
  return `<article class="univer-doc-body">
    ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n')}
  </article>`;
}

export function renderUniverJsonHtml(input: UniverRenderInput): string {
  const parsed = parseJson(input.contentBody);
  const safeTitle = escapeHtml(input.title);
  const noun = input.kind === 'deck' ? 'Deck' : 'Document';
  const body = parsed === null
    ? `<section class="univer-empty"><p>This ${noun.toLowerCase()} has invalid Univer JSON and cannot be rendered yet.</p></section>`
    : input.kind === 'deck'
      ? renderDeckBody(parsed)
      : renderDocBody(parsed);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light dark; --bg: #f8fafc; --ink: #172033; --soft: #64748b; --line: #d7dee8; --accent: #0f766e; --card: #ffffff; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #101418; --ink: #ecfdf5; --soft: #9ca3af; --line: #334155; --accent: #2dd4bf; --card: #151d25; }
    }
    html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .univer-wrap { max-width: 72rem; margin: 0 auto; padding: 1.5rem; }
    .univer-header { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; margin-bottom: 1rem; }
    .univer-header h1 { margin: 0; font-size: clamp(1.4rem, 2.5vw, 2.2rem); }
    .univer-badge { border: 1px solid var(--accent); color: var(--accent); border-radius: 999px; padding: 0.18rem 0.55rem; font-size: 0.76rem; font-weight: 800; white-space: nowrap; }
    .univer-note { margin: 0 0 1rem; color: var(--soft); font-size: 0.9rem; }
    .univer-slide { aspect-ratio: 16 / 9; display: flex; flex-direction: column; gap: 0.9rem; margin-bottom: 1rem; padding: 2rem 2.4rem; border: 1px solid var(--line); border-radius: 0.75rem; background: var(--card); box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
    .slide-kicker { color: var(--soft); font-size: 0.78rem; font-weight: 800; text-transform: uppercase; }
    .univer-slide h2 { margin: 0; font-size: clamp(1.6rem, 3.2vw, 2.8rem); line-height: 1.08; }
    .univer-slide ul { margin: 0.4rem 0 0; padding-left: 1.25rem; display: grid; gap: 0.55rem; font-size: clamp(1rem, 1.5vw, 1.3rem); line-height: 1.45; }
    .univer-doc-body { max-width: 52rem; padding: 1.4rem 1.6rem; border: 1px solid var(--line); border-radius: 0.75rem; background: var(--card); }
    .univer-doc-body p { margin: 0 0 0.8rem; font-size: 1rem; line-height: 1.65; }
    .univer-empty { display: grid; place-items: center; min-height: 18rem; border: 1px dashed var(--line); border-radius: 0.75rem; color: var(--soft); background: var(--card); }
    .muted { color: var(--soft); }
  </style>
</head>
<body>
  <main class="univer-wrap" aria-label="Univer JSON ${noun}: ${safeTitle}">
    <header class="univer-header">
      <h1>${safeTitle}</h1>
      <span class="univer-badge">Univer JSON ${noun}</span>
    </header>
    <p class="univer-note">Rendered from the room-owned Univer JSON artefact. Edits remain stored through the ANT artefact API.</p>
    ${body}
  </main>
</body>
</html>`;
}
