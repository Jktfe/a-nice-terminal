import { queries } from './db.js';
import { capturePromptInput } from './prompt-capture.js';
import { loadMessagesForAgentContext } from './chat-context.js';
import type {
  InterviewMessageRecord,
  InterviewParticipant,
  InterviewRecord,
} from '$lib/shared/interview-contract.js';

const SUBMIT_DELAY_MS = 150;
const CLAUDE_DOUBLE_RETURN_DELAY_MS = 150;

export interface InterviewDelivery {
  targetId: string;
  handle: string | null;
  delivered: boolean;
  reason?: string;
}

function ptmWrite(sessionId: string, data: string): void {
  const write = (globalThis as any).__antPtmWrite;
  if (write) {
    write(sessionId, data);
    return;
  }
  import('./pty-client.js').then((m) => m.ptyClient.write(sessionId, data)).catch(() => {});
}

function sanitizeInline(value: string | null | undefined, max = 2000): string {
  return String(value ?? '')
    .slice(0, max)
    .replace(/[\n\r]+/g, ' ')
    .replace(/['"`()$;\\|&<>{}[\]!#~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function participantLabel(participant: InterviewParticipant): string {
  return sanitizeInline(participant.handle || participant.display_name || participant.name || participant.session_id, 120);
}

function transcriptSnippet(messages: InterviewMessageRecord[], currentMessageId: string): string {
  const previous = messages.filter((m) => m.id !== currentMessageId).slice(-6);
  if (previous.length === 0) return 'none yet';
  return previous.map((m) => {
    const speaker = m.role === 'agent'
      ? (m.speaker_session_id ? sanitizeInline(m.speaker_session_id, 80) : 'agent')
      : 'user';
    return `${speaker}: ${sanitizeInline(m.content, 220)}`;
  }).join(' | ');
}

function roomContextSnippet(roomId: string, maxMessages = 6): string {
  const messages = loadMessagesForAgentContext(roomId, { limit: maxMessages });
  if (messages.length === 0) return 'none';
  return messages.map((m) => {
    const speaker = m.sender_id || (m.role === 'user' ? 'user' : m.role || 'unknown');
    return `${sanitizeInline(speaker, 80)}: ${sanitizeInline(m.content, 180)}`;
  }).join(' | ');
}

function summaryTranscriptSnippet(messages: InterviewMessageRecord[], participants: InterviewParticipant[]): string {
  const labels = new Map<string, string>();
  for (const participant of participants) labels.set(participant.session_id, participantLabel(participant));
  const lines = messages.map((m) => {
    const speaker = m.role === 'agent'
      ? (m.speaker_session_id ? labels.get(m.speaker_session_id) || m.speaker_session_id : 'agent')
      : 'user';
    return `${speaker}: ${sanitizeInline(m.content, 320)}`;
  });
  return sanitizeInline(lines.join(' | ') || 'no interview messages were exchanged', 2600);
}

function buildInterviewPrompt(input: {
  interview: InterviewRecord;
  participant: InterviewParticipant;
  userMessage: InterviewMessageRecord;
  roomName: string;
  sourceContent: string;
  messages: InterviewMessageRecord[];
  participants: InterviewParticipant[];
}): string {
  const roomName = sanitizeInline(input.roomName || 'unknown room', 120);
  const roomId = sanitizeInline(input.interview.room_id, 80);
  const interviewId = sanitizeInline(input.interview.id, 80);
  const target = participantLabel(input.participant);
  const source = sanitizeInline(input.sourceContent || 'source message unavailable', 260);
  const question = sanitizeInline(input.userMessage.content);
  const participantList = input.participants.map(participantLabel).filter(Boolean).join(', ') || target;
  const recent = transcriptSnippet(input.messages, input.userMessage.id);
  const roomContext = roomContextSnippet(input.interview.room_id);
  const replyCmd = `ant interview send ${interviewId} --session ${roomId} --msg YOURREPLY`;
  const routingHint = 'Routing: this reply is saved to the interview only; do not use ant chat send unless you intend to post in the room.';

  return `[ant interview message for you] room: ${roomName} id ${roomId} interview: ${interviewId} -- selected agents: ${participantList} -- source message: ${source} -- bounded room context: ${roomContext} -- user asks: ${question} -- recent interview: ${recent} -- reply as ${target} with: ${replyCmd} -- ${routingHint}`;
}

export async function routeInterviewUserMessage(
  interview: InterviewRecord,
  userMessage: InterviewMessageRecord,
): Promise<InterviewDelivery[]> {
  const room = queries.getSession(interview.room_id) as any;
  const source = interview.source_message_id
    ? queries.getMessage(interview.source_message_id) as any
    : null;
  const participants = queries.listInterviewParticipants(interview.id) as InterviewParticipant[];
  const messages = queries.listInterviewMessages(interview.id) as InterviewMessageRecord[];
  const deliveries: InterviewDelivery[] = [];

  for (const participant of participants) {
    const session = queries.getSession(participant.session_id) as any;
    const handle = participant.handle || session?.handle || null;
    if (!session) {
      deliveries.push({ targetId: participant.session_id, handle, delivered: false, reason: 'session_not_found' });
      continue;
    }
    if (session.type !== 'terminal' && session.type !== 'agent') {
      deliveries.push({ targetId: participant.session_id, handle, delivered: false, reason: 'session_not_agent' });
      continue;
    }

    const prompt = buildInterviewPrompt({
      interview,
      participant,
      userMessage,
      roomName: room?.name || interview.room_id,
      sourceContent: source?.content || '',
      messages,
      participants,
    });
    if (!prompt) {
      deliveries.push({ targetId: participant.session_id, handle, delivered: false, reason: 'empty_prompt' });
      continue;
    }

    ptmWrite(participant.session_id, prompt);
    capturePromptInput(participant.session_id, prompt, {
      captureSource: 'interview_injection',
      transport: 'interview-routing',
      messageId: userMessage.id,
      roomId: interview.room_id,
      target: handle,
    });

    if (process.env.NODE_ENV !== 'test') {
      const needsDoubleReturn = session.cli_flag === 'claude-code';
      setTimeout(() => {
        ptmWrite(participant.session_id, '\r');
        if (needsDoubleReturn) {
          setTimeout(() => ptmWrite(participant.session_id, '\r'), CLAUDE_DOUBLE_RETURN_DELAY_MS);
        }
      }, SUBMIT_DELAY_MS);
    }
    deliveries.push({ targetId: participant.session_id, handle, delivered: true });
  }

  return deliveries;
}

export async function routeInterviewSummaryRequest(interview: InterviewRecord): Promise<InterviewDelivery[]> {
  const participant = queries.getInterviewParticipant(interview.id, interview.target_session_id) as InterviewParticipant | undefined;
  if (!participant) {
    return [{ targetId: interview.target_session_id, handle: null, delivered: false, reason: 'target_not_participant' }];
  }

  const session = queries.getSession(participant.session_id) as any;
  const handle = participant.handle || session?.handle || null;
  if (!session) {
    return [{ targetId: participant.session_id, handle, delivered: false, reason: 'session_not_found' }];
  }
  if (session.type !== 'terminal' && session.type !== 'agent') {
    return [{ targetId: participant.session_id, handle, delivered: false, reason: 'session_not_agent' }];
  }

  const room = queries.getSession(interview.room_id) as any;
  const source = interview.source_message_id
    ? queries.getMessage(interview.source_message_id) as any
    : null;
  const participants = queries.listInterviewParticipants(interview.id) as InterviewParticipant[];
  const messages = queries.listInterviewMessages(interview.id) as InterviewMessageRecord[];
  const roomName = sanitizeInline(room?.name || interview.room_id, 120);
  const roomId = sanitizeInline(interview.room_id, 80);
  const interviewId = sanitizeInline(interview.id, 80);
  const sourceContent = sanitizeInline(source?.content || 'source message unavailable', 320);
  const transcriptRef = sanitizeInline(interview.transcript_ref || interview.transcript_path || 'no transcript reference yet', 220);
  const transcript = summaryTranscriptSnippet(messages, participants);
  const replyCmd = `ant interview summary ${interviewId} --session ${roomId} --msg YOURSUMMARY`;
  const prompt = `[ant interview summary requested] room: ${roomName} id ${roomId} interview: ${interviewId} -- source message: ${sourceContent} -- transcript ref: ${transcriptRef} -- interview transcript: ${transcript} -- write a concise summary for the room with key findings and useful follow-ups. Post it with: ${replyCmd} -- Routing: this posts a reply to the original chat message with meta.interview_id and transcript_ref.`;

  ptmWrite(participant.session_id, prompt);
  capturePromptInput(participant.session_id, prompt, {
    captureSource: 'interview_injection',
    transport: 'interview-summary-request',
    messageId: interview.id,
    roomId: interview.room_id,
    target: handle,
  });

  if (process.env.NODE_ENV !== 'test') {
    const needsDoubleReturn = session.cli_flag === 'claude-code';
    setTimeout(() => {
      ptmWrite(participant.session_id, '\r');
      if (needsDoubleReturn) {
        setTimeout(() => ptmWrite(participant.session_id, '\r'), CLAUDE_DOUBLE_RETURN_DELAY_MS);
      }
    }, SUBMIT_DELAY_MS);
  }

  return [{ targetId: participant.session_id, handle, delivered: true }];
}
