/**
 * Safe markdown → HTML renderer for chat messages.
 *
 * marked (GFM) + a small allowlist sanitizer for XSS protection. Wraps tables in
 * scrollable containers for mobile/overflow safety.
 *
 * Why not sanitize-html: sanitize-html pulls PostCSS, and Vite 8 externalizes
 * PostCSS's node:path usage in browser bundles. The room page renders markdown
 * on the client too, so the sanitizer must be browser-safe and synchronous.
 */
import { marked } from 'marked';
import { DomUtils, parseDocument } from 'htmlparser2';

type HtmlNode = {
  name?: string;
  attribs?: Record<string, string>;
  children?: HtmlNode[];
  parent?: HtmlNode | null;
  prev?: HtmlNode | null;
  next?: HtmlNode | null;
};

const ALLOWED_TAGS = new Set([
  'a', 'b', 'i', 'em', 'strong', 'code', 'pre', 'p', 'br', 'hr',
  'ul', 'ol', 'li', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'span', 'div', 'img'
]);

const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'name', 'target', 'rel']),
  code: new Set(['class']),
  pre: new Set(['class']),
  span: new Set(['class']),
  div: new Set(['class']),
  img: new Set(['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding']),
  th: new Set(['align']),
  td: new Set(['align'])
};

function isSafeLinkUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) return false;
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:')
  );
}

function isSafeImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) return false;
  return trimmed.startsWith('/') || trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

function cleanAttributes(tagName: string, attribs: Record<string, string> = {}): Record<string, string> {
  const allowedForTag = ALLOWED_ATTRIBUTES[tagName];
  const cleaned: Record<string, string> = {};
  if (allowedForTag) {
    for (const [name, value] of Object.entries(attribs)) {
      const attrName = name.toLowerCase();
      if (!allowedForTag.has(attrName)) continue;
      if (attrName === 'href' && !isSafeLinkUrl(value)) continue;
      if (attrName === 'src' && !isSafeImageUrl(value)) continue;
      cleaned[attrName] = value;
    }
  }
  if (tagName === 'a') {
    cleaned.rel = 'noopener noreferrer';
  } else if (tagName === 'img' && cleaned.src) {
    cleaned.loading = cleaned.loading ?? 'lazy';
    cleaned.decoding = cleaned.decoding ?? 'async';
  }
  return cleaned;
}

function relinkChildren(parent: HtmlNode, children: HtmlNode[]): void {
  parent.children = children;
  children.forEach((child, index) => {
    child.parent = parent;
    child.prev = children[index - 1] ?? null;
    child.next = children[index + 1] ?? null;
  });
}

function sanitizeChildren(parent: HtmlNode): HtmlNode[] {
  const children = parent.children ?? [];
  const cleaned: HtmlNode[] = [];
  for (const child of children) {
    cleaned.push(...sanitizeNode(child));
  }
  relinkChildren(parent, cleaned);
  return cleaned;
}

function sanitizeNode(node: HtmlNode): HtmlNode[] {
  if (!DomUtils.isTag(node as never)) {
    return DomUtils.isText(node as never) ? [node] : [];
  }

  const tagName = (node.name ?? '').toLowerCase();
  const children = sanitizeChildren(node);
  if (!ALLOWED_TAGS.has(tagName)) {
    return tagName === 'script' || tagName === 'style' ? [] : children;
  }

  node.name = tagName;
  node.attribs = cleanAttributes(tagName, node.attribs);
  if (tagName === 'img' && !node.attribs.src) return [];
  return [node];
}

function sanitizeMarkdownHtml(html: string): string {
  const document = parseDocument(html, {
    decodeEntities: true,
    lowerCaseAttributeNames: true,
    lowerCaseTags: true
  });
  sanitizeChildren(document as HtmlNode);
  return DomUtils.getOuterHTML(document.children, {
    decodeEntities: true,
    encodeEntities: 'utf8',
    selfClosingTags: false
  });
}

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
  return wrapTables(sanitizeMarkdownHtml(parsed));
}
