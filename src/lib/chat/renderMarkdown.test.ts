/**
 * Markdown render tests for chat messages.
 *
 * Task #59 / M-MSGRENDER slice 1 / evolveantdeep
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './renderMarkdown';

describe('renderMarkdown', () => {
  it('returns empty string for null/undefined/empty input', () => {
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
    expect(renderMarkdown('')).toBe('');
  });

  it('renders plain text as paragraph', () => {
    const result = renderMarkdown('Hello world');
    expect(result).toContain('Hello world');
  });

  it('renders bold and italic', () => {
    const result = renderMarkdown('**bold** and *italic*');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
  });

  it('renders inline code', () => {
    const result = renderMarkdown('use `ant chat send`');
    expect(result).toContain('<code>ant chat send</code>');
  });

  it('renders links', () => {
    const result = renderMarkdown('[ANT](https://antapp.dev)');
    expect(result).toContain('href="https://antapp.dev"');
    expect(result).toContain('ANT');
  });

  it('renders markdown tables', () => {
    const table = [
      '| Task | Owner | Status |',
      '|------|-------|--------|',
      '| Fix 5 | codex | done |',
      '| Web UI | svelte | in_progress |',
    ].join('\n');
    const result = renderMarkdown(table);
    expect(result).toContain('<table>');
    expect(result).toContain('<th>Task</th>');
    expect(result).toContain('<td>codex</td>');
    expect(result).toContain('<td>done</td>');
  });

  it('renders code blocks', () => {
    const result = renderMarkdown('```ts\nconst x = 1;\n```');
    expect(result).toContain('<pre>');
    expect(result).toContain('<code');
    expect(result).toContain('const x = 1;');
  });

  it('shows pasted block html tags as inert text', () => {
    const result = renderMarkdown('<div class="note">Hello</div>');
    expect(result).toContain('&lt;div class="note"&gt;Hello&lt;/div&gt;');
    expect(result).not.toContain('<div class="note">');
  });

  it('shows pasted inline html tags as inert text', () => {
    const result = renderMarkdown('paste <button onclick="alert(1)">go</button> here');
    expect(result).toContain('paste &lt;button onclick="alert(1)"&gt;go&lt;/button&gt; here');
    expect(result).not.toContain('<button');
  });

  it('renders unordered lists', () => {
    const result = renderMarkdown('- item 1\n- item 2');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>item 1</li>');
    expect(result).toContain('<li>item 2</li>');
  });

  it('strips XSS vectors (script tags)', () => {
    const result = renderMarkdown('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;alert("xss")&lt;/script&gt;');
  });

  it('strips XSS vectors (event handlers)', () => {
    const result = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renders markdown images for Stage decks and external manual screenshots', () => {
    const result = renderMarkdown('![Rooms list](/api/assets/manual/rooms-index.png "Rooms")');
    expect(result).toContain('<img');
    expect(result).toContain('src="/api/assets/manual/rooms-index.png"');
    expect(result).toContain('alt="Rooms list"');
    expect(result).toContain('title="Rooms"');
    expect(result).toContain('loading="lazy"');
    expect(result).toContain('decoding="async"');
  });

  it('strips unsafe image protocols completely', () => {
    const result = renderMarkdown('![bad](javascript:alert(1))');
    expect(result).not.toContain('<img');
    expect(result).not.toContain('javascript:');
  });

  // JWPK 2026-05-18 in ANT artefacts room: CLI-sent messages contain
  // literal `\n` because shells don't interpret \n inside double-quoted
  // strings. The renderer now unescapes \n / \t / \r before marked sees
  // the text so line breaks actually render. Authors who want a literal
  // backslash-n in output write `\\n`.
  it('converts literal \\n to a newline so CLI-sent messages render line breaks', () => {
    const result = renderMarkdown('line one\\nline two');
    expect(result).toContain('<br>');
    expect(result).toContain('line one');
    expect(result).toContain('line two');
    expect(result).not.toContain('\\n');
  });

  it('converts literal \\t to a tab', () => {
    const result = renderMarkdown('col1\\tcol2');
    expect(result).toContain('\t');
    expect(result).not.toContain('\\t');
  });

  it('preserves an escaped literal backslash-n via \\\\n', () => {
    const result = renderMarkdown('write \\\\n for a literal');
    expect(result).toContain('\\n');
  });
});
