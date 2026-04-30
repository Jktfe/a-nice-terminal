import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { publicOrigin } from '$lib/server/room-invites';

export function GET({ params, url }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');

  // Prefer ANT_PUBLIC_ORIGIN > ANT_SERVER_URL > request origin so off-Tailnet
  // joiners get a routable URL in their copy-paste curl line.
  const serverUrl = publicOrigin({ url });

  const commands: Record<string, string> = {};

  if (session.type === 'terminal') {
    commands.connect = `ant terminal ${session.id}`;
    commands.watch = `ant terminal watch ${session.id}`;
    commands.send = `ant terminal send ${session.id} --cmd "YOUR_COMMAND"`;
  }

  if (session.type === 'chat' || session.type === 'agent') {
    commands.join = `ant chat join ${session.id}`;
    commands.send = `ant chat send ${session.id} --msg "YOUR_MESSAGE"`;
    commands.read = `ant chat read ${session.id}`;
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

export function POST(event: RequestEvent<{ id: string }>) {
  return GET(event);
}
