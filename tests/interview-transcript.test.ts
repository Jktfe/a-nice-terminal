import { describe, expect, it } from 'vitest';
import { buildInterviewTranscript } from '../src/lib/voice/interview-transcript';

const baseInput = {
  interviewId: 'int_abc123',
  roomId: 'room_xyz',
  parentMessage: {
    id: 'msg_1',
    content: 'Hello, can you walk me through your reasoning on the M2 fan-out?',
    sender_id: '@evolveantcodex',
  },
  participants: [
    { handle: '@evolveantcodex', displayName: 'evolveantcodex', isTarget: true, muted: false },
    { handle: '@evolveantclaude', displayName: 'evolveantclaude', isTarget: false, muted: false },
  ],
  messages: [
    { role: 'user' as const, content: 'How are observers handled?', createdAt: 1715170800000 },
    { role: 'agent' as const, content: 'Observers are context-only by default.', agentHandle: '@evolveantcodex', createdAt: 1715170810000 },
  ],
  startedAt: 1715170800000,
  endedAt: 1715170900000,
};

describe('buildInterviewTranscript', () => {
  it('produces a deterministic doc id of the form interview-<interviewId>', () => {
    const t = buildInterviewTranscript(baseInput);
    expect(t.docId).toBe('interview-int_abc123');
  });

  it('embeds source room/message and quoted preview in the markdown', () => {
    const t = buildInterviewTranscript(baseInput);
    expect(t.markdown).toContain('## Source');
    expect(t.markdown).toContain('`room_xyz`');
    expect(t.markdown).toContain('`msg_1`');
    expect(t.markdown).toContain('@evolveantcodex');
    // The source quote stays inline (>) so Obsidian renders it as a quote block.
    expect(t.markdown).toMatch(/Source quote: > .+M2 fan-out/);
  });

  it('lists the target with a label and observers below', () => {
    const t = buildInterviewTranscript(baseInput);
    const partsBlock = t.markdown.split('## Participants')[1].split('## Timeline')[0];
    expect(partsBlock).toMatch(/\*\*evolveantcodex\*\* \(target\)/);
    expect(partsBlock).toMatch(/- evolveantclaude\b/);
    expect(partsBlock).not.toMatch(/evolveantclaude.*\(target/);
  });

  it('annotates muted participants in the participants list', () => {
    const t = buildInterviewTranscript({
      ...baseInput,
      participants: [
        { handle: '@evolveantcodex', displayName: 'evolveantcodex', isTarget: true, muted: false },
        { handle: '@evolveantclaude', displayName: 'evolveantclaude', isTarget: false, muted: true },
      ],
    });
    expect(t.markdown).toMatch(/evolveantclaude.*\(muted\)/);
  });

  it('renders messages chronologically with role-prefixed headings', () => {
    const t = buildInterviewTranscript(baseInput);
    const transcriptBlock = t.markdown.split('## Transcript')[1] ?? '';
    expect(transcriptBlock).toContain('### You');
    expect(transcriptBlock).toContain('### @evolveantcodex');
    expect(transcriptBlock).toContain('How are observers handled?');
    expect(transcriptBlock).toContain('Observers are context-only by default.');
  });

  it('renders ISO timestamps for messages with numeric epoch createdAt', () => {
    const t = buildInterviewTranscript(baseInput);
    expect(t.markdown).toContain(new Date(1715170800000).toISOString());
    expect(t.markdown).toContain(new Date(1715170810000).toISOString());
  });

  it('shows an empty-state line when no messages were exchanged', () => {
    const t = buildInterviewTranscript({ ...baseInput, messages: [] });
    expect(t.markdown).toContain('_No messages were exchanged in this interview._');
    expect(t.meta.messageCount).toBe(0);
  });

  it('populates meta with interview/room/parent ids and participant handles', () => {
    const t = buildInterviewTranscript(baseInput);
    expect(t.meta).toMatchObject({
      interviewId: 'int_abc123',
      roomId: 'room_xyz',
      parentMessageId: 'msg_1',
      participants: ['@evolveantcodex', '@evolveantclaude'],
      messageCount: 2,
    });
    expect(t.meta.startedAt).toBe(new Date(1715170800000).toISOString());
    expect(t.meta.endedAt).toBe(new Date(1715170900000).toISOString());
  });

  it('falls back to current time when endedAt is missing', () => {
    const before = Date.now();
    const t = buildInterviewTranscript({ ...baseInput, endedAt: null });
    const after = Date.now();
    const ended = Date.parse(t.meta.endedAt ?? '');
    expect(ended).toBeGreaterThanOrEqual(before);
    expect(ended).toBeLessThanOrEqual(after);
  });

  it('uses a date-stamped title that pairs nicely with Obsidian sort order', () => {
    const t = buildInterviewTranscript(baseInput);
    expect(t.title).toMatch(/^Interview · evolveantcodex · \d{4}-\d{2}-\d{2}$/);
  });

  it('clamps overlong source quotes so the Source block stays readable', () => {
    const longContent = 'a'.repeat(500);
    const t = buildInterviewTranscript({
      ...baseInput,
      parentMessage: { id: 'msg_long', content: longContent },
    });
    // Source quote shows up after "Source quote: > " — the clamp keeps
    // the visible body to roughly 240 chars + ellipsis, so the rendered
    // line is well under 300.
    const sourceLine = t.markdown
      .split('\n')
      .find((l) => l.includes('Source quote:'));
    expect(sourceLine).toBeDefined();
    expect((sourceLine ?? '').length).toBeLessThan(300);
    expect(sourceLine).toMatch(/…$/);
  });
});
