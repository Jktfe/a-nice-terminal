import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';
import { readGlobalInterviewVoiceConfig } from '../src/lib/server/interviews.js';
import { POST as startInterview } from '../src/routes/api/interviews/start/+server.js';
import { GET as getInterview } from '../src/routes/api/interviews/[id]/+server.js';
import { POST as appendInterviewMessage } from '../src/routes/api/interviews/[id]/messages/+server.js';
import {
  DELETE as removeInterviewParticipant,
  PATCH as updateInterviewParticipant,
  POST as addInterviewParticipant,
} from '../src/routes/api/interviews/[id]/participants/+server.js';
import { POST as postInterviewSummary } from '../src/routes/api/interviews/[id]/summary/+server.js';
import { POST as endInterview } from '../src/routes/api/interviews/[id]/end/+server.js';

type StartArgs = Parameters<typeof startInterview>[0];
type GetArgs = Parameters<typeof getInterview>[0];
type MessageArgs = Parameters<typeof appendInterviewMessage>[0];
type ParticipantArgs = Parameters<typeof addInterviewParticipant>[0];
type SummaryArgs = Parameters<typeof postInterviewSummary>[0];
type EndArgs = Parameters<typeof endInterview>[0];

let dataDir = '';
let originalDataDir: string | undefined;
let originalElevenLabsKey: string | undefined;
let originalVoiceProvider: string | undefined;

const ROOM_ID = 'room-interview-contract';
const SOURCE_MESSAGE_ID = 'msg-source-agent';
const SUMMARY_MESSAGE_ID = 'msg-summary';

function request(body: unknown, url = 'https://ant.test/api/interviews'): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function event<T>(overrides: Partial<T>): T {
  return { locals: {}, ...overrides } as T;
}

function seedRoom() {
  queries.createSession(ROOM_ID, 'Interview Test Room', 'chat', '15m', null, null, '{}');
  queries.createSession('agent-a', 'Agent A', 'terminal', '15m', null, null, '{}');
  queries.createSession('agent-b', 'Agent B', 'terminal', '15m', null, null, '{}');
  queries.createSession('agent-c', 'Agent C', 'terminal', '15m', null, null, '{}');
  queries.setHandle('agent-a', '@agent-a', 'Agent A');
  queries.setHandle('agent-b', '@agent-b', 'Agent B');
  queries.setHandle('agent-c', '@agent-c', 'Agent C');
  queries.addRoomMember(ROOM_ID, 'agent-a', 'participant', 'codex-cli', '@agent-a');
  queries.addRoomMember(ROOM_ID, 'agent-b', 'participant', 'claude-code', '@agent-b');
  queries.createMessage(
    SOURCE_MESSAGE_ID,
    ROOM_ID,
    'assistant',
    'Here is the source answer to interview.',
    'text',
    'complete',
    'agent-a',
    null,
    null,
    'message',
    '{}',
  );
  queries.createMessage(
    SUMMARY_MESSAGE_ID,
    ROOM_ID,
    'assistant',
    'Interview summary',
    'text',
    'complete',
    'agent-a',
    null,
    SOURCE_MESSAGE_ID,
    'message',
    JSON.stringify({ interview_id: 'placeholder' }),
  );
}

async function start(body: Record<string, unknown>) {
  return startInterview(event<StartArgs>({ request: request(body) }));
}

async function append(interviewId: string, body: Record<string, unknown>) {
  return appendInterviewMessage(event<MessageArgs>({
    params: { id: interviewId },
    request: request(body, `https://ant.test/api/interviews/${interviewId}/messages`),
  }));
}

async function addParticipant(interviewId: string, body: Record<string, unknown>): Promise<Response> {
  return await addInterviewParticipant(event<ParticipantArgs>({
    params: { id: interviewId },
    request: request(body, `https://ant.test/api/interviews/${interviewId}/participants`),
    url: new URL(`https://ant.test/api/interviews/${interviewId}/participants`),
  })) as Response;
}

async function patchParticipant(interviewId: string, body: Record<string, unknown>): Promise<Response> {
  return await updateInterviewParticipant(event<ParticipantArgs>({
    params: { id: interviewId },
    request: request(body, `https://ant.test/api/interviews/${interviewId}/participants`),
    url: new URL(`https://ant.test/api/interviews/${interviewId}/participants`),
  })) as Response;
}

async function deleteParticipant(interviewId: string, body: Record<string, unknown>): Promise<Response> {
  return await removeInterviewParticipant(event<ParticipantArgs>({
    params: { id: interviewId },
    request: request(body, `https://ant.test/api/interviews/${interviewId}/participants`),
    url: new URL(`https://ant.test/api/interviews/${interviewId}/participants`),
  })) as Response;
}

async function finish(interviewId: string, body: Record<string, unknown>) {
  return endInterview(event<EndArgs>({
    params: { id: interviewId },
    request: request(body, `https://ant.test/api/interviews/${interviewId}/end`),
  }));
}

async function summary(interviewId: string, body: Record<string, unknown>) {
  return postInterviewSummary(event<SummaryArgs>({
    params: { id: interviewId },
    request: request(body, `https://ant.test/api/interviews/${interviewId}/summary`),
  }));
}

describe('interview lite contract', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    originalElevenLabsKey = process.env.ELEVENLABS_API_KEY;
    originalVoiceProvider = process.env.ANT_INTERVIEW_VOICE_PROVIDER;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-interview-contract-'));
    process.env.ANT_DATA_DIR = dataDir;
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ANT_INTERVIEW_VOICE_PROVIDER;
    (globalThis as any).__antPtmWrite = () => {};
    _resetForTest();
    getDb();
    seedRoom();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).__antPtmWrite;
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    if (originalElevenLabsKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalElevenLabsKey;
    if (originalVoiceProvider === undefined) delete process.env.ANT_INTERVIEW_VOICE_PROVIDER;
    else process.env.ANT_INTERVIEW_VOICE_PROVIDER = originalVoiceProvider;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('starts a dedicated interview from a room message and includes all selected agents as active participants', async () => {
    const res = await start({
      room_id: ROOM_ID,
      source_message_id: SOURCE_MESSAGE_ID,
      participant_session_ids: ['agent-b'],
      muted_session_ids: ['agent-b'],
      title: 'Probe the answer',
      meta: { caller: 'test' },
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.interview.room_id).toBe(ROOM_ID);
    expect(body.interview.source_message_id).toBe(SOURCE_MESSAGE_ID);
    expect(body.interview.target_session_id).toBe('agent-a');
    expect(body.interview.status).toBe('active');
    expect(body.voice).toEqual({ provider: 'browser', elevenlabsConfigured: false });
    expect(JSON.parse(body.interview.meta)).toMatchObject({
      caller: 'test',
      selected_agents_reply_by_default: true,
      mute_controls_tts_only: true,
      global_voice_config: true,
    });
    expect(body.participants.map((p: any) => [p.session_id, p.role, p.muted])).toEqual([
      ['agent-a', 'target', 0],
      ['agent-b', 'participant', 1],
    ]);

    const dbRows = getDb().prepare('SELECT COUNT(*) AS count FROM interview_messages WHERE interview_id = ?').get(body.interview.id) as any;
    expect(dbRows.count).toBe(0);
  });

  it('rejects selected agents that are not active participants in the source room', async () => {
    const res = await start({
      room_id: ROOM_ID,
      source_message_id: SOURCE_MESSAGE_ID,
      participant_session_ids: ['agent-c'],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('agent agent-c is not an active participant');
  });

  it('appends user and agent interview messages without posting them into the room message table', async () => {
    const started = await (await start({
      room_id: ROOM_ID,
      source_message_id: SOURCE_MESSAGE_ID,
      participant_session_ids: ['agent-b'],
    })).json();
    const interviewId = started.interview.id;

    const userRes = await append(interviewId, {
      role: 'user',
      content: 'Can you explain the tradeoff?',
    });
    expect(userRes.status).toBe(201);
    expect((await userRes.clone().json()).deliveries).toHaveLength(2);

    const agentRes = await append(interviewId, {
      role: 'agent',
      speaker_session_id: 'agent-b',
      content: 'The tradeoff is latency versus clarity.',
      audio_cache_key: `interviews/${interviewId}/agent-b/reply-1.mp3`,
      audio_mime_type: 'audio/mpeg',
      audio_duration_ms: 1200,
    });
    expect(agentRes.status).toBe(201);

    const bundle = await getInterview(event<GetArgs>({
      params: { id: interviewId },
      url: new URL(`https://ant.test/api/interviews/${interviewId}`),
    }) as any).json();
    expect(bundle.messages.map((m: any) => [m.role, m.speaker_session_id, m.content])).toEqual([
      ['user', null, 'Can you explain the tradeoff?'],
      ['agent', 'agent-b', 'The tradeoff is latency versus clarity.'],
    ]);

    const roomCount = getDb().prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id = ?').get(ROOM_ID) as any;
    expect(roomCount.count).toBe(2);
  });

  it('adds, mutes, and removes same-room interview participants through the participant API', async () => {
    const started = await (await start({
      room_id: ROOM_ID,
      source_message_id: SOURCE_MESSAGE_ID,
    })).json();
    const interviewId = started.interview.id;

    const addRes = await addParticipant(interviewId, { handle: '@agent-b' });
    expect(addRes.status).toBe(201);
    let body = await addRes.json();
    expect(body.participants.map((p: any) => p.session_id)).toEqual(['agent-a', 'agent-b']);

    const muteRes = await patchParticipant(interviewId, { handle: '@agent-b', muted: true });
    expect(muteRes.status).toBe(200);
    body = await muteRes.json();
    expect(body.participants.find((p: any) => p.session_id === 'agent-b')?.muted).toBe(1);

    const removeTarget = await deleteParticipant(interviewId, { handle: '@agent-a' });
    expect(removeTarget.status).toBe(400);
    expect((await removeTarget.json()).error).toContain('target participant cannot be removed');

    const removeRes = await deleteParticipant(interviewId, { handle: '@agent-b' });
    expect(removeRes.status).toBe(200);
    body = await removeRes.json();
    expect(body.participants.map((p: any) => p.session_id)).toEqual(['agent-a']);
  });

  it('fans user interview turns out to every selected agent with scoped reply instructions', async () => {
    vi.useFakeTimers();
    const writes: Array<{ sessionId: string; data: string }> = [];
    (globalThis as any).__antPtmWrite = (sessionId: string, data: string) => {
      writes.push({ sessionId, data });
    };

    const started = await (await start({
      room_id: ROOM_ID,
      source_message_id: SOURCE_MESSAGE_ID,
      participant_session_ids: ['agent-b'],
      muted_session_ids: ['agent-b'],
    })).json();

    const res = await append(started.interview.id, {
      role: 'user',
      content: 'What should we ask next?',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.deliveries.map((d: any) => [d.targetId, d.delivered])).toEqual([
      ['agent-a', true],
      ['agent-b', true],
    ]);

    const prompts = writes.filter((w) => w.data !== '\r');
    expect(prompts.map((w) => w.sessionId)).toEqual(['agent-a', 'agent-b']);
    for (const prompt of prompts.map((w) => w.data)) {
      expect(prompt).toContain('[ant interview message for you]');
      expect(prompt).toContain(`interview: ${started.interview.id}`);
      expect(prompt).toContain('source message: Here is the source answer to interview.');
      expect(prompt).toContain('user asks: What should we ask next?');
      expect(prompt).toContain(`ant interview send ${started.interview.id} --session ${ROOM_ID} --msg YOURREPLY`);
      expect(prompt).toContain('saved to the interview only');
      expect(prompt).toContain('do not use ant chat send unless you intend to post in the room');
    }

    await vi.runAllTimersAsync();
    vi.useRealTimers();
  });

  it('accepts agent replies by handle and stores them in interview_messages only', async () => {
    const started = await (await start({
      room_id: ROOM_ID,
      source_message_id: SOURCE_MESSAGE_ID,
      participant_session_ids: ['agent-b'],
    })).json();

    const agentRes = await append(started.interview.id, {
      role: 'agent',
      speaker_session_id: '@agent-b',
      content: 'I would ask about deployment order.',
    });
    expect(agentRes.status).toBe(201);

    const bundle = await getInterview(event<GetArgs>({
      params: { id: started.interview.id },
      url: new URL(`https://ant.test/api/interviews/${started.interview.id}`),
    }) as any).json();
    expect(bundle.messages.map((m: any) => [m.role, m.speaker_session_id, m.content])).toEqual([
      ['agent', 'agent-b', 'I would ask about deployment order.'],
    ]);

    const roomCount = getDb().prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id = ?').get(ROOM_ID) as any;
    expect(roomCount.count).toBe(2);
  });

  it('rejects agent messages from speakers outside the interview participant set', async () => {
    const started = await (await start({
      room_id: ROOM_ID,
      source_message_id: SOURCE_MESSAGE_ID,
    })).json();

    const res = await append(started.interview.id, {
      role: 'agent',
      speaker_session_id: 'agent-b',
      content: 'I was not selected.',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('not an interview participant');
  });

  it('ends an interview with transcript and summary metadata for post-back', async () => {
    const started = await (await start({
      room_id: ROOM_ID,
      source_message_id: SOURCE_MESSAGE_ID,
    })).json();

    const res = await finish(started.interview.id, {
      transcript_ref: 'obsidian://Interviews/2026-05-08/probe.md',
      transcript_path: 'Interviews/2026-05-08/probe.md',
      summary_message_id: SUMMARY_MESSAGE_ID,
      summary_status: 'posted',
      meta: { completed_by: 'agent-a' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.interview.status).toBe('ended');
    expect(body.interview.transcript_ref).toBe('obsidian://Interviews/2026-05-08/probe.md');
    expect(body.interview.summary_message_id).toBe(SUMMARY_MESSAGE_ID);
    expect(body.interview.summary_status).toBe('posted');
    expect(JSON.parse(body.interview.meta)).toMatchObject({ completed_by: 'agent-a' });
  });

  it('requests a target-agent summary on end and posts that summary back to the source chat message', async () => {
    const writes: Array<{ sessionId: string; data: string }> = [];
    (globalThis as any).__antPtmWrite = (sessionId: string, data: string) => {
      writes.push({ sessionId, data });
    };

    const started = await (await start({
      room_id: ROOM_ID,
      source_message_id: SOURCE_MESSAGE_ID,
      participant_session_ids: ['agent-b'],
    })).json();
    const interviewId = started.interview.id;

    await append(interviewId, { role: 'user', content: 'What did we learn?' });
    await append(interviewId, { role: 'agent', speaker_session_id: '@agent-a', content: 'We learned the route should be bounded.' });

    const endRes = await finish(interviewId, {
      transcript_ref: 'interview-test-doc',
      transcript_path: 'research/interview-test-doc.md',
    });
    expect(endRes.status).toBe(200);
    const ended = await endRes.json();
    expect(ended.interview.summary_status).toBe('requested');
    expect(ended.summary_deliveries).toEqual([{ targetId: 'agent-a', handle: '@agent-a', delivered: true }]);

    const summaryPrompt = writes.find((w) => w.sessionId === 'agent-a' && w.data.includes('[ant interview summary requested]'))?.data ?? '';
    expect(summaryPrompt).toContain(`interview: ${interviewId}`);
    expect(summaryPrompt).toContain('transcript ref: interview-test-doc');
    expect(summaryPrompt).toContain('user: What did we learn?');
    expect(summaryPrompt).toContain('@agent-a: We learned the route should be bounded.');
    expect(summaryPrompt).toContain(`ant interview summary ${interviewId} --session ${ROOM_ID} --msg YOURSUMMARY`);
    expect(summaryPrompt).toContain('meta.interview_id and transcript_ref');

    const postRes = await summary(interviewId, {
      speaker_session_id: '@agent-a',
      summary_text: 'Summary: bounded routing, transcript saved, follow up on hardening.',
    });
    expect(postRes.status).toBe(201);
    const posted = await postRes.json();
    expect(posted.message).toMatchObject({
      session_id: ROOM_ID,
      role: 'assistant',
      sender_id: 'agent-a',
      reply_to: SOURCE_MESSAGE_ID,
      msg_type: 'interview_summary',
      content: 'Summary: bounded routing, transcript saved, follow up on hardening.',
    });
    expect(JSON.parse(posted.message.meta)).toMatchObject({
      source: 'interview_summary',
      interview_id: interviewId,
      transcript_ref: 'interview-test-doc',
      transcript_path: 'research/interview-test-doc.md',
      source_message_id: SOURCE_MESSAGE_ID,
      summary_agent_session_id: 'agent-a',
    });
    expect(posted.interview.summary_message_id).toBe(posted.message.id);
    expect(posted.interview.summary_status).toBe('posted');

    const roomSummary = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(posted.message.id) as any;
    expect(roomSummary.reply_to).toBe(SOURCE_MESSAGE_ID);
    const interviewMessageCount = getDb().prepare('SELECT COUNT(*) AS count FROM interview_messages WHERE interview_id = ?').get(interviewId) as any;
    expect(interviewMessageCount.count).toBe(2);
  });

  it('uses global ElevenLabs settings only when server config supplies a key', () => {
    process.env.ANT_INTERVIEW_VOICE_PROVIDER = 'elevenlabs';
    expect(readGlobalInterviewVoiceConfig()).toEqual({
      provider: 'browser',
      elevenlabsConfigured: false,
    });

    process.env.ELEVENLABS_API_KEY = 'test-elevenlabs-key';
    expect(readGlobalInterviewVoiceConfig()).toEqual({
      provider: 'elevenlabs',
      elevenlabsConfigured: true,
    });
  });
});
