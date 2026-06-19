/**
 * Port audit (2026-06-19): source
 * codex/desk-core-model:src/routes/api/desks/[deskId]/config/+server.ts
 * lines 1-40. Verdict: CHANGE. vNext simplification: same PATCH shape,
 * backed by the deployed Desk facade and explicit owner/operator auth.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TerminalDeskError, updateDeskConfig } from '$lib/server/terminalDeskFacade';
import { requireTerminalDeskMutationActor } from '$lib/server/terminalDeskMutationAuth';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const deskId = params.deskId ?? '';
  if (!deskId) throw error(400, 'Desk id required.');
  const { actor } = requireTerminalDeskMutationActor(request, deskId);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required.');
  try {
    return json(updateDeskConfig({
      deskId,
      actor,
      persistence: body.persistence,
      coOwners: body.coOwners,
      writeGrants: body.writeGrants,
      defaultKillAction: body.defaultKillAction,
      killDefault: body.killDefault,
      messageDelivery: body.messageDelivery,
      deliveryMode: body.deliveryMode,
      deliveryTarget: body.deliveryTarget,
      deliveryTargetMode: body.deliveryTargetMode
    }));
  } catch (cause) {
    if (cause instanceof TerminalDeskError) throw error(cause.status, cause.message);
    throw cause;
  }
};
