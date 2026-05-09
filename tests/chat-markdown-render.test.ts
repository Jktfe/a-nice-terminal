import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderChatMarkdown } from '../src/lib/markdown/chat-markdown.js';

describe('renderChatMarkdown', () => {
  it('renders GFM tables as semantic, scrollable message tables', () => {
    const html = renderChatMarkdown([
      '| Agent | Status | Notes |',
      '| --- | --- | --- |',
      '| Codex | Done | Parser + styles |',
      '| Claude | Active | Perf audit |',
    ].join('\n'));

    expect(html).toContain('class="chat-md-table-wrap"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Scrollable message table"');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Agent</th>');
    expect(html).toContain('<td>Codex</td>');
    expect(html).toContain('</table></div>');
  });

  it('does not promote ordinary pipe-heavy text into a table', () => {
    const html = renderChatMarkdown('keep this as plain text: alpha | beta | gamma');

    expect(html).not.toContain('chat-md-table-wrap');
    expect(html).not.toContain('<table>');
    expect(html).toContain('alpha | beta | gamma');
  });

  it('sanitizes message content before adding trusted table wrappers', () => {
    const html = renderChatMarkdown([
      '| Safe | Value |',
      '| --- | --- |',
      '| yes | <img src=x onerror="alert(1)"> <button onclick="alert(3)">click</button> |',
      '',
      '<script>alert(2)</script>',
    ].join('\n'));

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onclick');
    expect(html).toContain('chat-md-table-wrap');
    expect(html).toContain('<button>click</button>');
  });
});

describe('MessageBubble markdown render path', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/MessageBubble.svelte'),
    'utf8',
  );

  it('derives rendered markdown from message.content instead of reparsing on every hover/render', () => {
    expect(source).toContain("import { renderChatMarkdown } from '$lib/markdown/chat-markdown'");
    expect(source).toContain('const renderedContent = $derived(renderChatMarkdown(message.content))');
    expect(source).toContain('{@html renderedContent}');
    expect(source).not.toContain('{@html renderMarkdown(message.content)}');
  });

  it('keeps message tables readable and horizontally scrollable on narrow screens', () => {
    expect(source).toContain('.message-markdown :global(.chat-md-table-wrap)');
    expect(source).toContain('overflow-x: auto');
    expect(source).toContain('min-width: 100%');
    expect(source).toContain('@media (max-width: 640px)');
  });
});
