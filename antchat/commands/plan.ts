// antchat plan — pretty-print the room's plan events.
//
// Plan events are room-scoped run-events of a known kind ("decision", "step",
// "blocker", etc.) projected from messages, terminal output, and explicit
// CLI calls. The /api/plan endpoint already does the heavy lifting; antchat
// just renders the result for readers without a browser.

import { api } from '../../cli/lib/api.js';
import { config } from '../../cli/lib/config.js';

const KIND_COLOURS: Record<string, string> = {
  decision: '\x1b[36m',  // cyan
  step:     '\x1b[34m',  // blue
  blocker:  '\x1b[31m',  // red
  done:     '\x1b[32m',  // green
  note:     '\x1b[2m',   // dim
  evidence: '\x1b[35m',  // magenta
};

const RESET = '\x1b[0m';

function colourKind(kind: string): string {
  return `${KIND_COLOURS[kind] ?? ''}${kind.padEnd(8, ' ')}${RESET}`;
}

function shortTime(ts_ms: number | string | undefined): string {
  if (ts_ms == null) return '          ';
  const ms = typeof ts_ms === 'string' ? Number(ts_ms) : ts_ms;
  if (!Number.isFinite(ms)) return '          ';
  return new Date(ms).toISOString().slice(11, 19);
}

export async function plan(args: string[], flags: any, ctx: any) {
  const roomId = args[0];
  if (!roomId) {
    console.error('Usage: antchat plan <room-id> [--plan-id ant-r4] [--limit 200]');
    process.exit(1);
  }

  const handleFlag = typeof flags.handle === 'string' ? flags.handle : undefined;
  const tok = config.getRoomToken(roomId, handleFlag);
  if (!tok) {
    console.error(`antchat plan: no token for room ${roomId}. Run: antchat join ...`);
    process.exit(1);
  }

  const serverUrl = (ctx.serverUrl || tok.server_url || config.get('serverUrl') || '').trim();
  if (!serverUrl) {
    console.error('antchat plan: no server URL - pass --server or rejoin to capture server_url in the token.');
    process.exit(1);
  }

  const callCtx = { ...ctx, serverUrl };
  const planId = typeof flags['plan-id'] === 'string' ? flags['plan-id'] : (typeof flags.planId === 'string' ? flags.planId : 'ant-r4');
  const limit = Number(flags.limit) || 200;
  const params = new URLSearchParams({ session_id: roomId, plan_id: planId, limit: String(limit) });

  const result = await api.get(callCtx, `/api/plan?${params.toString()}`, { roomToken: tok.token });

  if (ctx.json) { console.log(JSON.stringify(result)); return; }

  const events = (result?.events || []) as Array<Record<string, any>>;
  if (!events.length) {
    console.log(`No plan events for ${roomId} (plan_id=${planId}).`);
    return;
  }

  console.log(`Plan ${planId} for ${roomId} - ${events.length} event${events.length === 1 ? '' : 's'}`);
  for (const e of events) {
    const time = shortTime(e.ts_ms);
    const kind = colourKind(String(e.kind ?? 'note'));
    const text = (e.text ?? '').toString().split('\n')[0];
    console.log(`  ${time}  ${kind}  ${text}`);
  }

  const errors = (result?.errors || []) as Array<Record<string, any>>;
  if (errors.length) {
    console.log(`\nSkipped ${errors.length} malformed event${errors.length === 1 ? '' : 's'} (run with --json to inspect).`);
  }
}
