// ant msg <session-id> [text]          → broadcast to @everyone
// ant msg <session-id> @handle [text]  → targeted delivery
// ant msg <session-id> @everyone [text]→ explicit broadcast

import { api } from '../lib/api.js';
import { config } from '../lib/config.js';
import { execFileSync } from 'child_process';

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

  // Resolve sender: flag override > ANT_SESSION_ID env > tmux session name (reliable
  // since ANT uses session IDs as tmux session names) > config handle > 'cli'
  let sender_id: string = flags.from || process.env.ANT_SESSION_ID || '';
  if (!sender_id) {
    try {
      sender_id = execFileSync('tmux', ['display-message', '-p', '#{session_name}'], { stdio: 'pipe' }).toString().trim();
    } catch {}
  }
  if (!sender_id) sender_id = config.get('handle') || 'Gemini';

  // Auto-attach the per-room bearer token saved by `ant join-room`.
  const tok = config.getRoomToken(sessionId);
  const opts = tok?.token ? { roomToken: tok.token } : undefined;
  const result = await api.post(ctx, `/api/sessions/${sessionId}/messages`, {
    role: 'user',
    content,
    format: 'text',
    sender_id,
    target,
    msg_type: 'message',
  }, opts);

  if (ctx.json) { console.log(JSON.stringify(result)); return; }

  const to = target ? `→ ${target}` : '→ @everyone';
  console.log(`\x1b[36m${sender_id}\x1b[0m ${to}: ${content}`);
}
