// ant msg <session-id> [text]          → broadcast to @everyone
// ant msg <session-id> @handle [text]  → targeted delivery
// ant msg <session-id> @everyone [text]→ explicit broadcast

import { api } from '../lib/api.js';
import { config } from '../lib/config.js';

export async function msg(args: string[], flags: any, ctx: any) {
  const sessionId = args[0];
  if (!sessionId) {
    console.error('Usage: ant msg <session-id> [@handle] "message"');
    return;
  }

  // Detect optional @handle as second arg
  let target: string | null = null;
  let textStart = 1;
  if (args[1] && args[1].startsWith('@')) {
    target = args[1] === '@everyone' ? null : args[1];
    textStart = 2;
  }

  const content = flags.msg || args[textStart] || '';
  if (!content) {
    console.error('Usage: ant msg <session-id> [@handle] "message"');
    return;
  }

  // Prefer session ID (canonical) over handle string
  const sender_id = flags.from || config.get('sessionId') || config.get('handle') || 'cli';

  const result = await api.post(ctx, `/api/sessions/${sessionId}/messages`, {
    role: 'user',
    content,
    format: 'text',
    sender_id,
    target,
    msg_type: 'message',
  });

  if (ctx.json) { console.log(JSON.stringify(result)); return; }

  const to = target ? `→ ${target}` : '→ @everyone';
  console.log(`\x1b[36m${sender_id}\x1b[0m ${to}: ${content}`);
}
