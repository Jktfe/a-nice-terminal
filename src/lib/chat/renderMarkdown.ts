/**
 * Safe markdown → HTML renderer for chat messages.
 *
 * marked (GFM) + sanitize-html for XSS protection. Wraps tables in
 * scrollable containers for mobile/overflow safety.
 *
 * Why sanitize-html not DOMPurify: DOMPurify needs a DOM (jsdom in
 * Node), and jsdom@29 pulls @exodus/bytes which became ESM-only —
 * breaking CJS-require chains in our Node-22 test runner. sanitize-html
 * is pure-Node, no DOM dep, identical security guarantee for the
 * markdown-derived HTML we feed it.
 */
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'a', 'b', 'i', 'em', 'strong', 'code', 'pre', 'p', 'br', 'hr',
    'ul', 'ol', 'li', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div', 'img'
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel'],
    code: ['class'],
    pre: ['class'],
    span: ['class'],
    div: ['class'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
    th: ['align'],
    td: ['align']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    img: ['http', 'https']
  },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  allowedIframeHostnames: [],
  // Allow repo-local/external served assets such as `/api/assets/manual/rooms-index.png` in
  // Stage decks without allowing protocol-relative or javascript URLs.
  allowedScriptHostnames: [],
  // HTML5 void elements, not XHTML — emit `<br>` not `<br />`. Matches
  // the markup marked produces directly and keeps chat-message tests
  // that grep for `<br>` working.
  selfClosing: [],
  // Marked emits href before the visible text; sanitize-html keeps both.
  // Force noopener+noreferrer on external links so a rogue rel attribute
  // can't open a tabnabbing path.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    img: (tagName, attribs) => {
      const src = attribs.src ?? '';
      if (!src.startsWith('/') && !src.startsWith('http://') && !src.startsWith('https://')) {
        return { tagName, attribs: { ...attribs, src: '' } };
      }
      return {
        tagName,
        attribs: {
          ...attribs,
          loading: attribs.loading ?? 'lazy',
          decoding: attribs.decoding ?? 'async'
        }
      };
    }
  },
  exclusiveFilter: (frame) => {
    return frame.tag === 'img' && !frame.attribs.src;
  }
};

const TABLE_OPEN_RE = /<table(\s[^>]*)?>/gi;
const TABLE_CLOSE_RE = /<\/table>/gi;

const MARKDOWN_RENDERER = new marked.Renderer();

function escapeHtmlText(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

MARKDOWN_RENDERER.html = ({ text }) => escapeHtmlText(text);

function wrapTables(html: string): string {
  if (!html || !TABLE_OPEN_RE.test(html)) return html;
  TABLE_OPEN_RE.lastIndex = 0;
  TABLE_CLOSE_RE.lastIndex = 0;
  return html
    .replace(
      TABLE_OPEN_RE,
      '<div class="chat-md-table-wrap" role="region" aria-label="Scrollable message table" tabindex="0"><table$1>',
    )
    .replace(TABLE_CLOSE_RE, '</table></div>');
}

/**
 * Convert common shell-escape sequences embedded in posted text into
 * the actual characters so they render properly.
 *
 * Why: messages posted via `ant chat send --msg "line1\nline2"` carry
 * the literal characters `\` + `n` (the shell doesn't interpret `\n`
 * inside double-quoted strings unless `$'…'` ANSI-C quoting is used).
 * Marked treats those two characters as plain text, so the message
 * renders with visible `\n` markers instead of a line break. JWPK
 * flagged this on 2026-05-18 in the ANT artefacts room. We only
 * unescape `\n`, `\t`, and `\r` — the three sequences that have no
 * markdown meaning and are unambiguously control characters. Markdown's
 * own backslash escapes (`\*`, `\_`, `\\`, etc.) are untouched.
 *
 * To render a literal `\n` in text after this change, write `\\n` (the
 * standard shell + JSON convention).
 */
const UNESCAPE_RE = /\\+[ntr]/g;
function unescapeShellEscapes(raw: string): string {
  return raw.replace(UNESCAPE_RE, (match) => {
    const char = match.at(-1);
    const slashCount = match.length - 1;
    const escapedPairs = Math.floor(slashCount / 2);
    const prefix = '\\'.repeat(escapedPairs);
    if (slashCount % 2 === 0) return `${prefix}${char}`;
    if (char === 'n') return '\n';
    if (char === 't') return '\t';
    if (char === 'r') return '\r';
    return match;
  });
}

/**
 * Render raw markdown text to safe HTML.
 * Returns empty string for empty/null/undefined input.
 */
export function renderMarkdown(raw: string | null | undefined): string {
  if (!raw) return '';
  const normalised = unescapeShellEscapes(raw);
  const parsed = marked.parse(normalised, {
    breaks: true,
    gfm: true,
    renderer: MARKDOWN_RENDERER
  }) as string;
  return wrapTables(sanitizeHtml(parsed, SANITIZE_OPTIONS));
}
