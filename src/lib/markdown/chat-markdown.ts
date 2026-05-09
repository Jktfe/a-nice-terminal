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

export function renderChatMarkdown(text: string): string {
  if (!text) return '';
  // marked v17 has no built-in sanitizer and passes inline HTML through.
  // Message content is room/user controlled, so sanitize before {@html};
  // only trusted wrapper markup is added afterwards for table scrolling.
  const raw = marked.parse(text, { breaks: true, gfm: true }) as string;
  return wrapTables(DOMPurify.sanitize(raw));
}
