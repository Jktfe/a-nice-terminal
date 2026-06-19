/**
 * Port audit (2026-06-19): source
 * codex/desk-core-model:src/routes/api/desks/[deskId]/ant-view/+server.ts
 * lines 1-39. Verdict: CHANGE. vNext simplification: keep the query shape
 * antOS already uses and serve the first server-classified block envelope.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';
import { getTerminalDeskAntView } from '$lib/server/terminalDeskAntView';
import { TerminalDeskError } from '$lib/server/terminalDeskFacade';

function parseSinceMs(raw: string | null): number | null {
  if (!raw) return null;
  const relative = /^(\d+)([smhd])$/.exec(raw.trim());
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const multiplier =
      unit === 's' ? 1_000 :
      unit === 'm' ? 60_000 :
      unit === 'h' ? 60 * 60_000 :
      24 * 60 * 60_000;
    return Date.now() - amount * multiplier;
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLimit(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export const GET: RequestHandler = ({ params, request, url }) => {
  requireOperatorLikeAuth(request);
  const deskId = params.deskId ?? '';
  if (!deskId) throw error(400, 'Desk id required.');
  try {
    return json(getTerminalDeskAntView({
      deskId,
      limit: parseLimit(url.searchParams.get('limit')),
      sinceMs: parseSinceMs(url.searchParams.get('since')),
      query: url.searchParams.get('grep') ?? url.searchParams.get('query'),
      includeRaw: url.searchParams.get('raw') === '1' || url.searchParams.get('includeRaw') === '1'
    }));
  } catch (cause) {
    if (cause instanceof TerminalDeskError) throw error(cause.status, cause.message);
    throw cause;
  }
};
