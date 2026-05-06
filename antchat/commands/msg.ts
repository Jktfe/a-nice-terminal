// antchat msg — post a single message into a room over the bearer token.
// Supports an optional second positional arg as the @handle target; falls back
// to no-target (room-broadcast) when omitted.

import { api } from '../../cli/lib/api.js';
import { config } from '../../cli/lib/config.js';

export async function msg(args: string[], flags: any, ctx: any) {
  const roomId = args[0];
  if (!roomId) {
    console.error('Usage: antchat msg <room-id> [@handle] "message"');
    process.exit(1);
  }

  // Optional second arg is @handle target (room-broadcast otherwise).
  let target: string | null = null;
  let textStart = 1;
  if (args[1] && args[1].startsWith('@')) {
    target = args[1] === '@everyone' ? null : args[1];
    textStart = 2;
  }

  const content = String(flags.msg || args[textStart] || '').trim();
  if (!content) {
    console.error('Usage: antchat msg <room-id> [@handle] "message"');
    process.exit(1);
  }

  // Pick the right token for this room. With --handle, address a specific
  // identity; otherwise the room's default (most recent join) is used.
  const handleFlag = typeof flags.handle === 'string' ? flags.handle : undefined;
  const tok = config.getRoomToken(roomId, handleFlag);
  if (!tok) {
    if (handleFlag) {
      console.error(`antchat msg: no token for room ${roomId} under handle ${handleFlag}. Run: antchat join …`);
    } else {
      console.error(`antchat msg: no token for room ${roomId}. Run: antchat join …`);
    }
    process.exit(1);
  }

  // Resolve server: explicit --server flag > token's server_url > top-level config.
  const serverUrl = (ctx.serverUrl || tok.server_url || config.get('serverUrl') || '').trim();
  if (!serverUrl) {
    console.error('antchat msg: no server URL — pass --server or rejoin to capture server_url in the token.');
    process.exit(1);
  }

  const sender_id = tok.handle || (typeof flags.from === 'string' ? flags.from : 'antchat');

  const callCtx = { ...ctx, serverUrl };
  let result: any;
  try {
    result = await api.post(callCtx, `/api/sessions/${roomId}/messages`, {
      role: 'user',
      content,
      format: 'text',
      sender_id,
      target,
      msg_type: 'message',
    }, { roomToken: tok.token });
  } catch (err: any) {
    console.error(`antchat msg: ${err.message}`);
    process.exit(1);
  }

  if (ctx.json) {
    console.log(JSON.stringify(result));
    return;
  }

  const to = target ? `→ ${target}` : '→ @everyone';
  console.log(`\x1b[36m${sender_id}\x1b[0m ${to}: ${content}`);
}
