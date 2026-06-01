import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ChatMessage } from '$lib/server/chatMessageStore';
import { mergeQuietMessageFeed } from './quietMessageFeed';

function msg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    roomId: 'room-a',
    authorHandle: '@a',
    authorDisplayName: '@a',
    kind: 'human',
    body: 'hello',
    postedAt: '2026-05-14T00:00:00.000Z',
    postOrder: 1,
    ...overrides
  };
}

describe('mergeQuietMessageFeed', () => {
  it('appends new messages without replacing unchanged existing rows', () => {
    const existing = msg({ id: 'm1', postOrder: 1 });
    const next = msg({ id: 'm2', postOrder: 2, body: 'new' });
    const merged = mergeQuietMessageFeed([existing], [existing, next]);
    expect(merged).toEqual([existing, next]);
    expect(merged[0]).toBe(existing);
  });

  it('deduplicates by id and keeps postOrder order', () => {
    const first = msg({ id: 'm1', postOrder: 10 });
    const second = msg({ id: 'm2', postOrder: 5 });
    const merged = mergeQuietMessageFeed([first], [first, second, second]);
    expect(merged.map((message) => message.id)).toEqual(['m2', 'm1']);
  });

  it('replaces an existing row when server data changes', () => {
    const oldRow = msg({ id: 'm1', body: 'old' });
    const newRow = msg({ id: 'm1', body: 'edited' });
    const merged = mergeQuietMessageFeed([oldRow], [newRow]);
    expect(merged).toEqual([newRow]);
    expect(merged[0]).not.toBe(oldRow);
  });

  it('appends returned break messages into the same quiet feed', () => {
    const existing = msg({ id: 'm1', postOrder: 1 });
    const breakMessage = msg({
      id: 'b1',
      authorHandle: '@system',
      authorDisplayName: 'System',
      kind: 'system-break',
      body: 'Context break by @you.',
      postOrder: 2
    });
    expect(mergeQuietMessageFeed([existing], [breakMessage])).toEqual([existing, breakMessage]);
  });
});

describe('ChatComposer break forwarding guard', () => {
  it('forwards ComposerBreakHandler message payloads to the room merge callback', () => {
    const source = readFileSync('src/lib/components/ChatComposer.svelte', 'utf8');
    expect(source).toContain('function handleBreakPosted(message?: ChatMessage)');
    expect(source).toContain('onMessagePosted?.(message);');
  });

  it('keeps context break available through slash-command flow, not the stop icon', () => {
    const source = readFileSync('src/lib/components/ChatComposer.svelte', 'utf8');
    expect(source).toContain('looksLikeBreakCommand(trimmedBody)');
    expect(source).toContain('pendingBreakReason = reasonFromBreakCommand(trimmedBody);');
    expect(source).not.toContain('aria-label="Post context break"');
  });
});
