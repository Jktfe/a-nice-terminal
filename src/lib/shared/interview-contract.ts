export const INTERVIEW_STATUSES = ['active', 'ended', 'cancelled'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const INTERVIEW_MESSAGE_ROLES = ['user', 'agent', 'system'] as const;
export type InterviewMessageRole = (typeof INTERVIEW_MESSAGE_ROLES)[number];

export const INTERVIEW_PARTICIPANT_ROLES = ['target', 'participant'] as const;
export type InterviewParticipantRole = (typeof INTERVIEW_PARTICIPANT_ROLES)[number];

export const INTERVIEW_VOICE_PROVIDERS = ['browser', 'elevenlabs'] as const;
export type InterviewVoiceProvider = (typeof INTERVIEW_VOICE_PROVIDERS)[number];

export interface InterviewVoiceConfig {
  provider: InterviewVoiceProvider;
  elevenlabsConfigured: boolean;
}

export interface InterviewParticipant {
  interview_id: string;
  session_id: string;
  role: InterviewParticipantRole;
  muted: number;
  added_at: string;
  name?: string | null;
  handle?: string | null;
  display_name?: string | null;
  cli_flag?: string | null;
}

export interface InterviewRecord {
  id: string;
  room_id: string;
  source_message_id: string | null;
  target_session_id: string;
  status: InterviewStatus;
  title: string | null;
  created_by: string | null;
  transcript_ref: string | null;
  transcript_path: string | null;
  summary_message_id: string | null;
  summary_status: string | null;
  meta: string;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface InterviewMessageRecord {
  id: string;
  interview_id: string;
  role: InterviewMessageRole;
  speaker_session_id: string | null;
  content: string;
  format: string;
  status: string;
  audio_cache_key: string | null;
  audio_mime_type: string | null;
  audio_duration_ms: number | null;
  meta: string;
  created_at: string;
}

export function isInterviewStatus(value: unknown): value is InterviewStatus {
  return typeof value === 'string' && (INTERVIEW_STATUSES as readonly string[]).includes(value);
}

export function isInterviewMessageRole(value: unknown): value is InterviewMessageRole {
  return typeof value === 'string' && (INTERVIEW_MESSAGE_ROLES as readonly string[]).includes(value);
}

export function isInterviewVoiceProvider(value: unknown): value is InterviewVoiceProvider {
  return typeof value === 'string' && (INTERVIEW_VOICE_PROVIDERS as readonly string[]).includes(value);
}

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
