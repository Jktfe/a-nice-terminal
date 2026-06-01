import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatEnvelope } from './pty-inject-bridge';
import { resetIdentityDbForTests } from './db';
import { createDiscussion, closeOrReCloseDiscussion } from './chatDiscussionStore';

describe('formatEnvelope', () => {
  const reply = '\n\n[ANT reply instruction: respond with: ant chat reply m1 --stdin]';

  it('renders single-message envelope', () => {
    const out = formatEnvelope({
      head: { roomName: 'ant-build', roomId: 'r1', messageId: 'm1', senderHandle: '@a', body: 'hi' }
    });
    expect(out).toBe(`[ANT room ant-build id=r1 msg=m1] @a: hi${reply}`);
  });

  it('renders single-room batched envelope', () => {
    const out = formatEnvelope({
      head: { roomName: 'ant-build', roomId: 'r1', messageId: 'm1', senderHandle: '@a', body: 'first' },
      batchedExtras: [
        { roomName: 'ant-build', roomId: 'r1', messageId: 'm2', senderHandle: '@b', body: 'second' },
        { roomName: 'ant-build', roomId: 'r1', messageId: 'm3', senderHandle: '@c', body: 'third' }
      ]
    });
    expect(out).toContain('room ant-build');
    expect(out).toContain('3 messages:');
    expect(out).toContain('@a: first');
    expect(out).toContain('@b: second');
    expect(out).toContain('@c: third');
    expect(out).toContain('ant chat reply m3 --stdin');
  });

  it('renders cross-room batched envelope with per-message room labels', () => {
    const out = formatEnvelope({
      head: { roomName: 'ant-build', roomId: 'r1', messageId: 'm1', senderHandle: '@a', body: 'from-build' },
      batchedExtras: [
        { roomName: 'ant-evolve', roomId: 'r2', messageId: 'm2', senderHandle: '@b', body: 'from-evolve' }
      ]
    });
    expect(out).toContain('cross-room');
    expect(out).toContain('[room ant-build id=r1]');
    expect(out).toContain('[room ant-evolve id=r2]');
    expect(out).toContain('@a: from-build');
    expect(out).toContain('@b: from-evolve');
    expect(out).toContain('ant chat reply MESSAGE_ID --stdin');
  });

  it('reply-parent context (JWPK msg_wcq5fwlhg7 2026-05-19): tags header + inline excerpt', () => {
    const out = formatEnvelope({
      head: {
        roomName: 'ant-build',
        roomId: 'r1',
        messageId: 'm2',
        senderHandle: '@you',
        body: 'good shout',
        replyParent: {
          messageId: 'm1',
          senderHandle: '@evolveantsvelte',
          body: 'should we ship the Delete label?'
        }
      }
    });
    expect(out).toContain('msg=m2 reply-to=m1');
    expect(out).toContain('↳ replying to @evolveantsvelte: "should we ship the Delete label?"');
    expect(out).toContain('@you: good shout');
  });

  it('reply-parent context truncates parent body to 120 chars + collapses whitespace', () => {
    const longBody = 'word '.repeat(100); // 500 chars with spaces
    const out = formatEnvelope({
      head: {
        roomName: 'ant-build',
        roomId: 'r1',
        messageId: 'm2',
        senderHandle: '@you',
        body: 'short reply',
        replyParent: { messageId: 'm1', senderHandle: '@x', body: longBody }
      }
    });
    const match = out.match(/↳ replying to @x: "([^"]+)"/);
    expect(match).not.toBeNull();
    const preview = match![1];
    expect(preview.length).toBeLessThanOrEqual(120);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview).not.toMatch(/\s{2,}/);
  });

  it('reply-parent context: multi-line parent body collapses to single line', () => {
    const out = formatEnvelope({
      head: {
        roomName: 'ant-build',
        roomId: 'r1',
        messageId: 'm2',
        senderHandle: '@you',
        body: 'reply',
        replyParent: { messageId: 'm1', senderHandle: '@x', body: 'line one\nline two\n\nline three' }
      }
    });
    expect(out).toContain('↳ replying to @x: "line one line two line three"');
  });

  it('absent replyParent → header has no reply-to tag, no inline excerpt', () => {
    const out = formatEnvelope({
      head: { roomName: 'ant-build', roomId: 'r1', messageId: 'm1', senderHandle: '@a', body: 'hi' }
    });
    expect(out).not.toContain('reply-to=');
    expect(out).not.toContain('↳ replying to');
  });
});

describe('formatEnvelope — M3.4b discussion_id tag + closed-marker', () => {
  let tmpDir: string;
  const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-envelope-disc-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
  });
  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  });

  it('absent discussion_id → no discussion tag or closed marker', () => {
    const out = formatEnvelope({
      head: { roomName: 'ant-build', roomId: 'r1', messageId: 'm1', senderHandle: '@a', body: 'hi' }
    });
    expect(out).toContain('[ANT room ant-build id=r1 msg=m1] @a: hi');
    expect(out).not.toContain('disc=');
    expect(out).not.toContain('Discussion closed');
    expect(out).toContain('ant chat reply m1 --stdin');
  });

  it('present discussion_id (open) → disc=id tag in header, no marker on body', () => {
    const d = createDiscussion({ roomId: 'r-disc', parentMessageId: 'm0', opened_by: '@x' });
    const out = formatEnvelope({
      head: { roomName: 'ant-build', roomId: 'r-disc', messageId: 'm1', senderHandle: '@a', body: 'hi', discussion_id: d.id }
    });
    expect(out).toContain(`disc=${d.id}`);
    expect(out).not.toContain('Discussion closed');
    expect(out).toContain('@a: hi');
  });

  it('present discussion_id (closed) → disc=id tag AND [Discussion closed, summary] prepended to body', () => {
    const d = createDiscussion({ roomId: 'r-disc-closed', parentMessageId: 'm0', opened_by: '@x' });
    closeOrReCloseDiscussion({ discussionId: d.id, summary: 'wrapped up', closed_by: '@x' });
    const out = formatEnvelope({
      head: { roomName: 'ant-build', roomId: 'r-disc-closed', messageId: 'm1', senderHandle: '@a', body: 'postscript', discussion_id: d.id }
    });
    expect(out).toContain(`disc=${d.id}`);
    expect(out).toContain('[Discussion closed, summary: "wrapped up"]');
    expect(out).toContain('@a: [Discussion closed, summary: "wrapped up"] postscript');
  });
});

describe('formatEnvelope — replyParent context (JWPK msg_wcq5fwlhg7)', () => {
  it('absent replyParent → no reply-to tag, no ↳ line', () => {
    const out = formatEnvelope({
      head: { roomName: 'ant-build', roomId: 'r1', messageId: 'm1', senderHandle: '@a', body: 'hi' }
    });
    expect(out).not.toContain('reply-to=');
    expect(out).not.toContain('↳ replying to');
  });

  it('present replyParent → reply-to=parentId in header AND ↳ replying to @handle: "preview" line', () => {
    const out = formatEnvelope({
      head: {
        roomName: 'ant-build', roomId: 'r1', messageId: 'm2', senderHandle: '@a', body: 'thanks for catching that',
        replyParent: { messageId: 'm1', senderHandle: '@b', body: 'I think the spec might be wrong on item 3' }
      }
    });
    expect(out).toContain('msg=m2 reply-to=m1');
    expect(out).toContain('@a: thanks for catching that');
    expect(out).toContain('↳ replying to @b: "I think the spec might be wrong on item 3"');
  });

  it('long parent body → truncated to 120 chars with ellipsis, newlines collapsed', () => {
    const longBody = 'first line\nsecond line\n' + 'word '.repeat(40);
    const out = formatEnvelope({
      head: {
        roomName: 'r', roomId: 'r1', messageId: 'm2', senderHandle: '@a', body: 'reply',
        replyParent: { messageId: 'm1', senderHandle: '@b', body: longBody }
      }
    });
    const match = out.match(/↳ replying to @b: "([^"]+)"/);
    expect(match).not.toBeNull();
    const preview = match![1];
    expect(preview.length).toBeLessThanOrEqual(120);
    expect(preview).toContain('first line second line');
    expect(preview.endsWith('…')).toBe(true);
  });
});
