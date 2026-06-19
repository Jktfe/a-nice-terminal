/**
 * Port audit (2026-06-19): source
 * codex/desk-core-model:src/routes/api/desks/[deskId]/cli-profile/swap/+server.ts
 * lines 1-36. Verdict: CHANGE. vNext simplification: same verb shape,
 * backed by the deployed Desk facade and explicit owner/operator auth.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { swapDeskCliProfile, TerminalDeskError } from '$lib/server/terminalDeskFacade';
import { requireTerminalDeskMutationActor } from '$lib/server/terminalDeskMutationAuth';

export const POST: RequestHandler = async ({ params, request }) => {
  const deskId = params.deskId ?? '';
  if (!deskId) throw error(400, 'Desk id required.');
  const { actor } = await requireTerminalDeskMutationActor(request, deskId);
  const body = (await request.json().catch(() => null)) as {
    cli?: unknown;
    accountType?: unknown;
    subscription?: unknown;
    modelFamily?: unknown;
    rootFolder?: unknown;
    bootCommand?: unknown;
    cliSessionId?: unknown;
    cliSessionSource?: unknown;
  } | null;
  try {
    return json(swapDeskCliProfile({
      deskId,
      actor,
      cli: body?.cli,
      accountType: body?.accountType,
      subscription: body?.subscription,
      modelFamily: body?.modelFamily,
      rootFolder: body?.rootFolder,
      bootCommand: body?.bootCommand,
      cliSessionId: body?.cliSessionId,
      cliSessionSource: body?.cliSessionSource
    }));
  } catch (cause) {
    if (cause instanceof TerminalDeskError) throw error(cause.status, cause.message);
    throw cause;
  }
};
