import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { getCliMode } from '$lib/cli-modes';
import { broadcast } from '$lib/server/ws-broadcast';
import { ptyClient } from '$lib/server/pty-client';

export async function PATCH({ params, request }: RequestEvent<{ id: string }>) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const session = queries.getSession(params.id) as Record<string, unknown> | undefined;
  if (!session) return json({ error: 'Session not found' }, { status: 404 });

  const rawCliFlag = body?.cli_flag ?? null;
  if (rawCliFlag !== null && typeof rawCliFlag !== 'string') {
    return json({ error: 'cli_flag must be a string or null' }, { status: 400 });
  }

  const cliFlag = typeof rawCliFlag === 'string' && rawCliFlag.trim()
    ? rawCliFlag.trim()
    : null;
  const mode = cliFlag ? getCliMode(cliFlag) : undefined;

  // Validate slug
  if (cliFlag !== null && !mode) {
    return json({ error: `Invalid cli_flag: "${cliFlag}"` }, { status: 400 });
  }

  // Update cli_flag column
  queries.setCliFlag(params.id, cliFlag);

  // Also update meta.agent_driver
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse((session.meta as string) || '{}');
  } catch {
    meta = {};
  }
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
