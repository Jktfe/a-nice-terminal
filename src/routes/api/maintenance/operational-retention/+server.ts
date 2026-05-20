/**
 * POST /api/maintenance/operational-retention
 *
 * Operator-triggered retention sweep for high-volume operational telemetry.
 * Body: { retentionDays?, batchSize?, vacuum? }
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { pruneOperationalHistory } from '$lib/server/operationalRetention';

export const POST: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  const body = await readOptionalJsonObject(request);
  const retentionDays = optionalPositiveInteger(body.retentionDays, 'retentionDays');
  const batchSize = optionalPositiveInteger(body.batchSize, 'batchSize');
  const vacuum = body.vacuum === true;
  const result = pruneOperationalHistory({
    ...(retentionDays !== undefined && { retentionDays }),
    ...(batchSize !== undefined && { batchSize }),
    vacuum
  });
  return json(result);
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

function optionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw error(400, `${fieldName} must be a positive integer.`);
  }
  return value;
}
