/**
 * Safe markdown → HTML renderer for chat messages.
 *
 * Ported from v3 src/lib/markdown/chat-markdown.ts (M-MSGRENDER).
 * Uses marked (GFM) + isomorphic-dompurify for XSS protection.
 * Wraps tables in scrollable containers for mobile/overflow safety.
 *
 * Task #59 / M-MSGRENDER slice 1 (tables) / evolveantdeep
 */
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

const TABLE_OPEN_RE = /<table(\s[^>]*)?>/gi;
const TABLE_CLOSE_RE = /<\/table>/gi;

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
  const parsed = marked.parse(normalised, { breaks: true, gfm: true }) as string;
  return wrapTables(DOMPurify.sanitize(parsed));
}
