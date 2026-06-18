import { listBareMentionHandles } from './mentionRouting';

export type InlineReplyBlock = {
  index: number;
  text: string;
};

export type InlineReplyComment = {
  blockIndex: number;
  body: string;
};

export type InlineReplyTargetedMessage = {
  targetHandle: string;
  body: string;
};

const BLOCK_EXCERPT_LIMIT = 420;

export function splitMessageIntoInlineReplyBlocks(body: string): InlineReplyBlock[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let insideFence = false;

  function flushCurrent(): void {
    const text = current.join('\n').trim();
    if (text.length > 0) blocks.push(text);
    current = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const startsFence = trimmed.startsWith('```');

    if (!insideFence && trimmed.length === 0) {
      flushCurrent();
      continue;
    }

    if (!insideFence && current.length > 0 && startsNewVisibleBlock(trimmed)) {
      flushCurrent();
    }

    current.push(line);

    if (startsFence) {
      insideFence = !insideFence;
      if (!insideFence) flushCurrent();
    }
  }

  flushCurrent();

  const safeBlocks = blocks.length > 0 ? blocks : [body.trim()].filter(Boolean);
  return safeBlocks.map((text, index) => ({ index, text }));
}

export function buildInlineFullReplyBody(input: {
  sourceMessageId: string;
  sourceAuthorHandle: string;
  blocks: InlineReplyBlock[];
  comments: InlineReplyComment[];
}): string {
  const comments = normalisedComments(input.comments);
  const blockByIndex = new Map(input.blocks.map((block) => [block.index, block]));
  const sections = comments.map((comment, commentIndex) => {
    const block = blockByIndex.get(comment.blockIndex);
    const marker = inlineMarker(input.sourceMessageId, comment.blockIndex);
    return [
      `${commentIndex + 1}. ${marker}`,
      '',
      quoteForReply(block?.text ?? 'Source block unavailable.'),
      '',
      bracketBareMentions(comment.body)
    ].join('\n');
  });

  return [
    `Inline reply to ${informationalHandle(input.sourceAuthorHandle)} (${input.sourceMessageId})`,
    '',
    ...sections
  ].join('\n\n').trim();
}

export function buildInlineTargetedReplies(input: {
  sourceMessageId: string;
  sourceAuthorHandle: string;
  blocks: InlineReplyBlock[];
  comments: InlineReplyComment[];
}): InlineReplyTargetedMessage[] {
  const blockByIndex = new Map(input.blocks.map((block) => [block.index, block]));
  const messages: InlineReplyTargetedMessage[] = [];

  for (const comment of normalisedComments(input.comments)) {
    const targets = listBareMentionHandles(comment.body);
    for (const targetHandle of targets) {
      const block = blockByIndex.get(comment.blockIndex);
      messages.push({
        targetHandle,
        body: [
          `${targetHandle} inline reply request from ${informationalHandle(input.sourceAuthorHandle)}'s message (${input.sourceMessageId}, point ${comment.blockIndex + 1}).`,
          '',
          quoteForReply(block?.text ?? 'Source block unavailable.'),
          '',
          bracketBareMentions(comment.body)
        ].join('\n')
      });
    }
  }

  return dedupeTargetedMessages(messages);
}

function startsNewVisibleBlock(trimmedLine: string): boolean {
  return /^#{1,6}\s+/.test(trimmedLine)
    || /^[-*+]\s+/.test(trimmedLine)
    || /^\d+[.)]\s+/.test(trimmedLine)
    || /^>\s+/.test(trimmedLine);
}

function normalisedComments(comments: InlineReplyComment[]): InlineReplyComment[] {
  return comments
    .map((comment) => ({
      blockIndex: comment.blockIndex,
      body: comment.body.trim()
    }))
    .filter((comment) => comment.body.length > 0)
    .sort((left, right) => left.blockIndex - right.blockIndex);
}

function inlineMarker(sourceMessageId: string, blockIndex: number): string {
  return `[inline:${sourceMessageId}:${blockIndex + 1}]`;
}

function quoteForReply(text: string): string {
  const excerpt = truncateBlock(text);
  return excerpt
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function truncateBlock(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= BLOCK_EXCERPT_LIMIT) return trimmed;
  return `${trimmed.slice(0, BLOCK_EXCERPT_LIMIT - 3).trimEnd()}...`;
}

function bracketBareMentions(text: string): string {
  return text.replace(/(^|\s)@([A-Za-z0-9_-]+)(?=$|\s|[.,!?;:)\]])/g, '$1[@$2]');
}

function informationalHandle(handle: string): string {
  const trimmed = handle.trim();
  return trimmed.startsWith('@') ? `[${trimmed}]` : trimmed;
}

function dedupeTargetedMessages(messages: InlineReplyTargetedMessage[]): InlineReplyTargetedMessage[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const key = `${message.targetHandle}\n${message.body}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
