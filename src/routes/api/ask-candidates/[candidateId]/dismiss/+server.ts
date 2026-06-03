import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dismissAskCandidate } from '$lib/server/askCandidateStore';
import { getOperatorHandle } from '$lib/server/operatorHandle';

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await readOptionalJsonObject(request);
  const dismissedByHandle = normalizeHandle(body.dismissedByHandle, getOperatorHandle());
  try {
    const candidate = dismissAskCandidate({
      candidateId: params.candidateId,
      dismissedByHandle
    });
    return json({ candidate });
  } catch (causeOfFailure) {
    const message =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not dismiss ask candidate.';
    if (message.includes('not found')) throw error(404, message);
    throw error(400, message);
  }
};

async function readOptionalJsonObject(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (parseFailure) {
    if (parseFailure instanceof SyntaxError) throw error(400, 'Body must be valid JSON.');
    throw parseFailure;
  }
}

function normalizeHandle(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const trimmed = raw.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}
