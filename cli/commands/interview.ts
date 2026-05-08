import { api } from '../lib/api.js';
import { config } from '../lib/config.js';
import { detectNativeSession } from './chat.js';

function resolveIdentity(external: boolean, flags: any): string {
  const explicit = flags.speaker || flags.speaker_session_id || flags.from || flags.handle;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  if (external) return config.get('handle') || 'cli-external';
  const { isNative, sessionId } = detectNativeSession();
  if (isNative && sessionId) return sessionId;
  return config.get('handle') || 'cli';
}

function roomOpts(roomId: string | null): { roomToken?: string } | undefined {
  if (!roomId) return undefined;
  const t = config.getRoomToken(roomId);
  return t?.token ? { roomToken: t.token } : undefined;
}

export async function interview(args: string[], flags: any, ctx: any) {
  const sub = args[0];
  const id = ['send', 'reply', 'summary', 'summarize'].includes(sub) ? args[1] : sub;
  if (!id) {
    console.error('Usage: ant interview <send|summary> <interview-id> --msg "text" [--session <room-id>]');
    return;
  }

  if (sub === 'send' || sub === 'reply') {
    const msg = flags.msg || args.slice(2).join(' ');
    if (!msg || !String(msg).trim()) {
      console.error('Usage: ant interview send <interview-id> --msg "reply" [--session <room-id>]');
      return;
    }
    const roomId = typeof flags.session === 'string' ? flags.session : typeof flags.room === 'string' ? flags.room : null;
    const speaker = resolveIdentity(!!flags.external, flags);
    const result = await api.post(ctx, `/api/interviews/${encodeURIComponent(id)}/messages`, {
      role: 'agent',
      speaker_session_id: speaker,
      content: String(msg),
    }, roomOpts(roomId));
    if (ctx.json) {
      console.log(JSON.stringify(result));
      return;
    }
    console.log(`Interview reply sent: ${id}`);
    return;
  }

  if (sub === 'summary' || sub === 'summarize') {
    const msg = flags.msg || args.slice(2).join(' ');
    if (!msg || !String(msg).trim()) {
      console.error('Usage: ant interview summary <interview-id> --msg "summary" [--session <room-id>]');
      return;
    }
    const roomId = typeof flags.session === 'string' ? flags.session : typeof flags.room === 'string' ? flags.room : null;
    const speaker = resolveIdentity(!!flags.external, flags);
    const result = await api.post(ctx, `/api/interviews/${encodeURIComponent(id)}/summary`, {
      summary_text: String(msg),
      speaker_session_id: speaker,
    }, roomOpts(roomId));
    if (ctx.json) {
      console.log(JSON.stringify(result));
      return;
    }
    console.log(`Interview summary posted: ${id}`);
    return;
  }

  console.error('Usage: ant interview <send|summary> <interview-id> --msg "text" [--session <room-id>]');
}
