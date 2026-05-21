// Build a structured Markdown transcript from an interview-lite session
// for the m4 Obsidian export. Pure function so it's covered by unit
// tests without a DOM or server.
//
// Layout follows the existing research-doc convention used by other
// ANT exports — frontmatter handled by the docs API, body sections
// handled here. The doc id pattern is `interview-<interview_id>` so
// it's discoverable from the chat thread once the summary post-back
// (m5) lands and references it via meta.transcript_doc_id.

export interface InterviewTranscriptMessage {
  role: 'user' | 'agent';
  content: string;
  agentHandle?: string | null;
  createdAt?: number | string;
}

export interface InterviewTranscriptInput {
  interviewId: string;
  roomId: string;
  parentMessage: { id: string; content: string; sender_id?: string | null };
  participants: Array<{
    handle: string;
    displayName?: string | null;
    isTarget: boolean;
    muted: boolean;
  }>;
  messages: InterviewTranscriptMessage[];
  startedAt?: number | string | null;
  endedAt?: number | string | null;
}

export interface InterviewTranscript {
  /** Stable doc id used to create + later reference the doc. */
  docId: string;
  /** Title used for the doc create call. */
  title: string;
  /** Short description shown in the doc list. */
  description: string;
  /** Frontmatter-equivalent metadata (the docs API expects flat keys
   *  on the doc itself; we surface these so the caller can pick what
   *  to pass through). */
  meta: {
    interviewId: string;
    roomId: string;
    parentMessageId: string;
    participants: string[];
    messageCount: number;
    startedAt: string | null;
    endedAt: string | null;
  };
  /** The full markdown body written into the transcript section. */
  markdown: string;
}

function formatTimestamp(ts: number | string | null | undefined): string | null {
  if (ts == null) return null;
  if (typeof ts === 'string') return ts;
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function clampPreview(content: string, max = 120): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function buildInterviewTranscript(input: InterviewTranscriptInput): InterviewTranscript {
  const startedAt = formatTimestamp(input.startedAt);
  const endedAt = formatTimestamp(input.endedAt) ?? new Date().toISOString();
  const target = input.participants.find((p) => p.isTarget);
  const observers = input.participants.filter((p) => !p.isTarget);

  const lines: string[] = [];
  lines.push('## Source');
  lines.push('');
  lines.push(`- Room: \`${input.roomId}\``);
  lines.push(`- Source message: \`${input.parentMessage.id}\``);
  if (input.parentMessage.sender_id) {
    lines.push(`- Source sender: \`${input.parentMessage.sender_id}\``);
  }
  lines.push(`- Source quote: > ${clampPreview(input.parentMessage.content, 240)}`);
  lines.push('');

  lines.push('## Participants');
  lines.push('');
  if (target) {
    lines.push(`- **${target.displayName ?? target.handle}** (target${target.muted ? ', muted' : ''})`);
  }
  for (const o of observers) {
    lines.push(`- ${o.displayName ?? o.handle}${o.muted ? ' (muted)' : ''}`);
  }
  lines.push('');

  lines.push('## Timeline');
  lines.push('');
  if (startedAt) lines.push(`- Started: ${startedAt}`);
  lines.push(`- Ended: ${endedAt}`);
  lines.push(`- Messages: ${input.messages.length}`);
  lines.push('');

  lines.push('## Transcript');
  lines.push('');
  if (input.messages.length === 0) {
    lines.push('_No messages were exchanged in this interview._');
  } else {
    for (const m of input.messages) {
      const speaker = m.role === 'user' ? 'You' : (m.agentHandle ?? 'agent');
      const ts = formatTimestamp(m.createdAt);
      lines.push(`### ${speaker}${ts ? ` · ${ts}` : ''}`);
      lines.push('');
      lines.push(m.content);
      lines.push('');
    }
  }

  const docId = `interview-${input.interviewId}`;
  const targetLabel = target?.displayName ?? target?.handle ?? 'agent';
  return {
    docId,
    title: `Interview · ${targetLabel} · ${endedAt.slice(0, 10)}`,
    description: clampPreview(input.parentMessage.content, 160),
    meta: {
      interviewId: input.interviewId,
      roomId: input.roomId,
      parentMessageId: input.parentMessage.id,
      participants: input.participants.map((p) => p.handle),
      messageCount: input.messages.length,
      startedAt,
      endedAt,
    },
    markdown: lines.join('\n'),
  };
}
