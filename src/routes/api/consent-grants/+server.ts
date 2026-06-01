import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import {
  createConsentGrant,
  listConsentGrants,
  type ConsentGrantStatus
} from '$lib/server/consentGrantStore';

const VALID_STATUSES = new Set(['active', 'revoked', 'expired', 'exhausted']);

export const GET: RequestHandler = ({ request, url }) => {
  requireAdminAuth(request);
  const roomId = url.searchParams.get('roomId')?.trim();
  if (roomId !== undefined && roomId.length > 0 && !doesChatRoomExist(roomId)) {
    throw error(404, 'room not found');
  }
  const statusRaw = url.searchParams.get('status')?.trim();
  if (statusRaw && !VALID_STATUSES.has(statusRaw)) {
    throw error(400, 'status must be one of active|revoked|expired|exhausted.');
  }
  const grants = listConsentGrants({
    roomId: roomId && roomId.length > 0 ? roomId : undefined,
    grantedTo: url.searchParams.get('grantedTo') ?? url.searchParams.get('granted_to') ?? undefined,
    topic: url.searchParams.get('topic') ?? undefined,
    status: statusRaw as ConsentGrantStatus | undefined,
    includeInactive: url.searchParams.get('includeInactive') === '1'
  });
  return json({ grants });
};

export const POST: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  const body = await parseRequiredJsonBody(request);
  const roomId = requireString(body, 'roomId');
  if (!doesChatRoomExist(roomId)) throw error(404, 'room not found');
  const sourceSetRaw = body.sourceSet ?? body.source_set;
  if (sourceSetRaw !== undefined && !Array.isArray(sourceSetRaw)) {
    throw error(400, 'sourceSet must be an array of strings when present.');
  }
  const maxAnswersRaw = body.maxAnswers ?? body.max_answers;
  const maxAnswers =
    maxAnswersRaw === undefined || maxAnswersRaw === null
      ? null
      : Number(maxAnswersRaw);
  if (maxAnswers !== null && (!Number.isInteger(maxAnswers) || maxAnswers <= 0)) {
    throw error(400, 'maxAnswers must be a positive integer when present.');
  }
  try {
    const grant = createConsentGrant({
      roomId,
      grantedTo: requireString(body, 'grantedTo', 'granted_to'),
      topic: requireString(body, 'topic'),
      sourceSet: Array.isArray(sourceSetRaw)
        ? sourceSetRaw.filter((entry): entry is string => typeof entry === 'string')
        : [],
      duration: optionalString(body.duration, 'duration') ?? '1h',
      maxAnswers,
      createdBy: optionalString(body.createdBy ?? body.created_by, 'createdBy') ?? null
    });
    return json({ grant }, { status: 201 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'could not create consent grant';
    throw error(400, message);
  }
};

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length === 0) throw error(400, 'Body must be a JSON object.');
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (failure) {
    if (failure instanceof SyntaxError) throw error(400, 'Body must be valid JSON.');
    throw failure;
  }
}

function requireString(source: Record<string, unknown>, field: string, altField?: string): string {
  const value = source[field] ?? (altField ? source[altField] : undefined);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw error(400, `Field ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw error(400, `Field ${field} must be a string when present.`);
  return value;
}
