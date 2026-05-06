// antchat chat — interactive room session backed by SSE.
//
// Reuses cli/lib/sse.ts so backfill + live broadcast share dedup logic with
// the full ANT CLI. Per-room token is required (master apiKey isn't accepted
// on /mcp/room/:id/stream); rooms missing one fall back to read-only backfill.

import { api } from '../../cli/lib/api.js';
import { config } from '../../cli/lib/config.js';
import { subscribeRoomStream } from '../../cli/lib/sse.js';
import { notify, mentionsHandle, notifierAvailable } from '../lib/notifier.js';
import { createInterface } from 'readline';

const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

interface ChatMessage {
  id?: string;
  sessionId?: string;
  role?: string;
  content?: string;
  sender_id?: string;
  target?: string | null;
  created_at?: string;
}

function formatLine(msg: ChatMessage, myHandle: string | null): string {
  const sender = msg.sender_id || (msg.role === 'user' ? 'you' : 'ANT');
  const isMe = !!myHandle && (sender === myHandle || sender === myHandle.replace(/^@/, ''));
  const prefix = isMe ? cyan(sender) : yellow(sender);
  const target = msg.target ? dim(` -> ${msg.target}`) : '';
  const body = msg.content ?? '';
  const highlighted = myHandle && mentionsHandle(body, myHandle) ? magenta(body) : body;
  return `${prefix}${target}: ${highlighted}`;
}

export async function chat(args: string[], flags: any, ctx: any) {
  const roomId = args[0];
  if (!roomId) {
    console.error('Usage: antchat chat <room-id> [--handle @name]');
    process.exit(1);
  }

  const handleFlag = typeof flags.handle === 'string' ? flags.handle : undefined;
  const tok = config.getRoomToken(roomId, handleFlag);
  if (!tok) {
    if (handleFlag) {
      console.error(`antchat chat: no token for room ${roomId} under handle ${handleFlag}. Run: antchat join ...`);
    } else {
      console.error(`antchat chat: no token for room ${roomId}. Run: antchat join ...`);
    }
    process.exit(1);
  }

  const serverUrl = (ctx.serverUrl || tok.server_url || config.get('serverUrl') || '').trim();
  if (!serverUrl) {
    console.error('antchat chat: no server URL - pass --server or rejoin to capture server_url in the token.');
    process.exit(1);
  }

  const callCtx = { ...ctx, serverUrl };
  const myHandle = tok.handle || (typeof flags.from === 'string' ? flags.from : null);
  const sender_id = myHandle || 'antchat';
  const notifyOnMention = flags.quiet ? false : notifierAvailable();

  const limit = Number(flags.limit) || 20;
  let messages: ChatMessage[] = [];
  try {
    const hist = await api.get(callCtx, `/api/sessions/${roomId}/messages?limit=${limit}`, { roomToken: tok.token });
    messages = (hist.messages as ChatMessage[]) || [];
  } catch (err: any) {
    console.error(`antchat chat: failed to load history - ${err.message}`);
    process.exit(1);
  }
  for (const m of messages) console.log(formatLine(m, myHandle));

  console.log(dim('\n--- Joined chat (Ctrl+C to exit) ---\n'));

  const abort = subscribeRoomStream({
    serverUrl,
    roomId,
    token: tok.token,
    onEvent: ({ data }) => {
      const msg = data as ChatMessage & { type?: string };
      if (msg?.type !== 'message_created' || msg.sessionId !== roomId) return;
      if (myHandle && msg.sender_id === myHandle) return;
      process.stdout.write(`\r\x1b[K${formatLine(msg, myHandle)}\n${cyan(sender_id)}: `);
      if (notifyOnMention && msg.content && mentionsHandle(msg.content, myHandle)) {
        notify({
          title: `antchat - ${msg.sender_id || 'someone'}`,
          subtitle: roomId,
          message: msg.content.length > 240 ? `${msg.content.slice(0, 237)}...` : msg.content,
          sound: 'Glass',
        });
      }
    },
    onError: (err: any) => console.error(`Stream error: ${err?.message ?? err}`),
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: `${cyan(sender_id)}: ` });
  rl.prompt();
  rl.on('line', async (raw) => {
    const line = raw.trim();
    if (!line) { rl.prompt(); return; }

    let target: string | null = null;
    let content = line;
    const targetMatch = /^(@[^\s@]+)\s+(.+)$/.exec(line);
    if (targetMatch) {
      const candidate = targetMatch[1];
      if (candidate !== '@everyone') target = candidate;
      content = targetMatch[2];
    }

    try {
      await api.post(callCtx, `/api/sessions/${roomId}/messages`, {
        role: 'user',
        content,
        format: 'text',
        sender_id,
        target,
        msg_type: 'message',
      }, { roomToken: tok.token });
    } catch (err: any) {
      console.error(`antchat chat: send failed - ${err.message}`);
    }
    rl.prompt();
  });
  rl.on('close', () => { abort.abort(); process.exit(0); });
  process.on('SIGINT', () => { abort.abort(); process.exit(0); });
}
