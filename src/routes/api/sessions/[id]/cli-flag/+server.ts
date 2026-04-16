import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { getCliMode } from '$lib/cli-modes';
import { broadcast } from '$lib/server/ws-broadcast';
import { ptyClient } from '$lib/server/pty-client';

export async function PATCH({ params, request }: RequestEvent<{ id: string }>) {
  const body = await request.json();
  const cliFlag: string | null = body.cli_flag ?? null;
  const mode = cliFlag ? getCliMode(cliFlag) : undefined;

  // Validate slug
  if (cliFlag !== null && !mode) {
    throw error(400, `Invalid cli_flag: "${cliFlag}"`);
  }

  const session = queries.getSession(params.id) as Record<string, unknown> | undefined;
  if (!session) throw error(404, 'Session not found');

  // Update cli_flag column
  queries.setCliFlag(params.id, cliFlag);

  // Also update meta.agent_driver
  const meta = JSON.parse((session.meta as string) || '{}');
  if (cliFlag) {
    meta.agent_driver = cliFlag;
  } else {
    delete meta.agent_driver;
  }
  queries.updateSession(null, null, null, JSON.stringify(meta), params.id);

  // Notify the PTY daemon so it applies per-model line stripping
  if (session.type === 'terminal') {
    ptyClient.setCliFlag(params.id, cliFlag, mode?.stripLines ?? 0);
  }

  // Broadcast to all WS clients watching this session
  broadcast(params.id, {
    type: 'cli_flag_updated',
    sessionId: params.id,
    cli_flag: cliFlag,
  });

  return json({ id: params.id, cli_flag: cliFlag });
}
