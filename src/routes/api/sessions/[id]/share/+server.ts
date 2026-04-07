import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

export function GET({ params }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');

  const serverUrl = process.env.ANT_SERVER_URL ||
    `http://localhost:${process.env.ANT_PORT || 6458}`;

  const commands: Record<string, string> = {};

  if (session.type === 'terminal') {
    commands.connect = `ant terminal ${session.id} --server ${serverUrl}`;
    commands.watch = `ant terminal watch ${session.id} --server ${serverUrl}`;
    commands.send = `ant terminal send ${session.id} --cmd "YOUR_COMMAND" --server ${serverUrl}`;
  }

  if (session.type === 'chat' || session.type === 'agent') {
    commands.join = `ant chat join ${session.id} --server ${serverUrl}`;
    commands.send = `ant chat send ${session.id} --msg "YOUR_MESSAGE" --server ${serverUrl}`;
    commands.read = `ant chat read ${session.id} --server ${serverUrl}`;
  }

  // Universal commands
  commands.curl_health = `curl -sk ${serverUrl}/api/sessions/${session.id}`;

  return json({
    session_id: session.id,
    session_name: session.name,
    session_type: session.type,
    commands,
    // One-liner for agents that just need to get in fast
    quick_join: session.type === 'terminal'
      ? commands.connect
      : commands.join,
  });
}
