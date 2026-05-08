import { queries } from '$lib/server/db.js';
import {
  isInterviewVoiceProvider,
  parseJsonObject,
  type InterviewMessageRecord,
  type InterviewParticipant,
  type InterviewRecord,
  type InterviewVoiceConfig,
} from '$lib/shared/interview-contract.js';

export interface ResolvedInterviewAgent {
  id: string;
  name: string;
  handle: string | null;
  alias: string | null;
  cli_flag: string | null;
}

export interface InterviewBundle {
  interview: InterviewRecord;
  participants: InterviewParticipant[];
  messages: InterviewMessageRecord[];
  voice: InterviewVoiceConfig;
}

export function readGlobalInterviewVoiceConfig(): InterviewVoiceConfig {
  const elevenlabsConfigured = Boolean(process.env.ELEVENLABS_API_KEY?.trim());
  const requestedProvider =
    process.env.ANT_INTERVIEW_VOICE_PROVIDER ||
    process.env.INTERVIEW_VOICE_PROVIDER ||
    (elevenlabsConfigured ? 'elevenlabs' : 'browser');
  const provider = isInterviewVoiceProvider(requestedProvider) && requestedProvider === 'elevenlabs' && elevenlabsConfigured
    ? 'elevenlabs'
    : 'browser';
  return { provider, elevenlabsConfigured };
}

export function encodeInterviewMeta(meta: unknown, defaults: Record<string, unknown> = {}): string {
  const supplied = meta && typeof meta === 'object' && !Array.isArray(meta)
    ? meta as Record<string, unknown>
    : {};
  return JSON.stringify({ ...defaults, ...supplied });
}

function lookupRoomMember(roomId: string, ref: string): any | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;

  const direct = queries.getSession(trimmed) as any;
  if (direct) {
    return queries.getRoomMember(roomId, direct.id) as any;
  }

  const handle = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  const byHandle = queries.getSessionByHandle(handle) as any;
  if (byHandle) {
    return queries.getRoomMember(roomId, byHandle.id) as any;
  }

  return (queries.getMemberByAlias(roomId, trimmed) || queries.getMemberByAlias(roomId, handle)) as any | null;
}

export function resolveRoomAgent(roomId: string, ref: string): { ok: true; agent: ResolvedInterviewAgent } | { ok: false; error: string } {
  const member = lookupRoomMember(roomId, ref);
  if (!member || member.role !== 'participant') {
    return { ok: false, error: `agent ${ref} is not an active participant in this room` };
  }
  if (member.type !== 'terminal' && member.type !== 'agent') {
    return { ok: false, error: `participant ${ref} is not an agent session` };
  }
  return {
    ok: true,
    agent: {
      id: member.session_id,
      name: member.display_name || member.name || member.alias || member.handle || member.session_id,
      handle: member.handle || null,
      alias: member.alias || null,
      cli_flag: member.cli_flag || null,
    },
  };
}

export function inferTargetAgentRef(sourceMessage: any): string | null {
  if (typeof sourceMessage?.sender_id === 'string' && sourceMessage.sender_id.trim()) {
    return sourceMessage.sender_id.trim();
  }
  if (typeof sourceMessage?.target === 'string' && sourceMessage.target.trim() && sourceMessage.target !== '@everyone') {
    return sourceMessage.target.trim();
  }
  return null;
}

export function loadInterviewBundle(interviewId: string): InterviewBundle | null {
  const interview = queries.getInterview(interviewId) as InterviewRecord | undefined;
  if (!interview) return null;
  return {
    interview,
    participants: queries.listInterviewParticipants(interviewId) as InterviewParticipant[],
    messages: queries.listInterviewMessages(interviewId) as InterviewMessageRecord[],
    voice: readGlobalInterviewVoiceConfig(),
  };
}

export function mergeInterviewMeta(existingMeta: string | null | undefined, patch: unknown): string | null {
  if (patch === undefined) return null;
  const existing = parseJsonObject(existingMeta);
  const supplied = patch && typeof patch === 'object' && !Array.isArray(patch)
    ? patch as Record<string, unknown>
    : {};
  return JSON.stringify({ ...existing, ...supplied });
}
