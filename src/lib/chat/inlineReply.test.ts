import { describe, expect, it } from 'vitest';
import {
  buildInlineFullReplyBody,
  buildInlineTargetedReplies,
  splitMessageIntoInlineReplyBlocks
} from './inlineReply';
import { listBareMentionHandles } from './mentionRouting';

describe('splitMessageIntoInlineReplyBlocks', () => {
  it('splits long messages into clickable blocks without splitting code fences', () => {
    const blocks = splitMessageIntoInlineReplyBlocks([
      '# Heading',
      'Opening point',
      '',
      '- first item',
      '- second item',
      '',
      '```ts',
      'const handle = "@codex";',
      '```'
    ].join('\n'));

    expect(blocks.map((block) => block.text)).toEqual([
      '# Heading\nOpening point',
      '- first item',
      '- second item',
      '```ts\nconst handle = "@codex";\n```'
    ]);
  });
});

describe('buildInlineFullReplyBody', () => {
  it('adds positional markers and brackets active mentions in the full reply', () => {
    const blocks = splitMessageIntoInlineReplyBlocks('First point\n\nSecond point');
    const body = buildInlineFullReplyBody({
      sourceMessageId: 'msg_source',
      sourceAuthorHandle: '@JWPK',
      blocks,
      comments: [
        { blockIndex: 1, body: '@ecoantclaude please take this part.' },
        { blockIndex: 0, body: 'I will cover this.' }
      ]
    });

    expect(body).toContain('Inline reply to [@JWPK] (msg_source)');
    expect(body).toContain('[inline:msg_source:1]');
    expect(body).toContain('[inline:msg_source:2]');
    expect(body).toContain('[@ecoantclaude] please take this part.');
    expect(listBareMentionHandles(body)).toEqual([]);
  });
});

describe('buildInlineTargetedReplies', () => {
  it('sends only immediate context to bare-mentioned agents', () => {
    const blocks = splitMessageIntoInlineReplyBlocks('First point\n\nSecond point');
    const targeted = buildInlineTargetedReplies({
      sourceMessageId: 'msg_source',
      sourceAuthorHandle: '@JWPK',
      blocks,
      comments: [
        { blockIndex: 1, body: '@ecoantclaude please take this part with @ecoantcodex.' },
        { blockIndex: 0, body: 'No mention here.' }
      ]
    });

    expect(targeted).toHaveLength(2);
    expect(targeted[0].targetHandle).toBe('@ecoantclaude');
    expect(targeted[0].body).toContain('@ecoantclaude inline reply request');
    expect(targeted[0].body).toContain('> Second point');
    expect(targeted[0].body).not.toContain('First point');
    expect(targeted[0].body).toContain('[@ecoantcodex]');
    expect(listBareMentionHandles(targeted[0].body)).toEqual(['@ecoantclaude']);
  });
});
