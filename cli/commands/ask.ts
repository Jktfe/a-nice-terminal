import { api } from '../lib/api.js';
import { config } from '../lib/config.js';
import { buildNudgeSnippet } from '../lib/ask-nudge.js';
import { detectNativeSession } from './chat.js';

const ACTIVE_STATUS = 'open,candidate,deferred';
const ASK_ID_RE = /^A[A-Z2-9]{7,}$/;

function roomOpts(id?: string): { roomToken?: string } | undefined {
  if (!id) return undefined;
  const t = config.getRoomToken(id);
  return t?.token ? { roomToken: t.token } : undefined;
}

function resolveIdentity(external: boolean): string {
  if (!external) return detectNativeSession().sessionId || config.get('handle') || 'cli';
  return config.get('handle') || 'cli-external';
}

function pickText(args: string[], start: number, flags: any): string {
  return String(flags.msg || flags.message || flags.text || flags.question || args.slice(start).join(' ') || '').trim();
}

function actionFrom(raw: unknown): string {
  const value = String(raw || 'answer').toLowerCase();
  if (['approve', 'approved', 'yes', 'y', 'accept', 'go'].includes(value)) return 'approve';
  if (['reject', 'rejected', 'deny', 'no', 'n'].includes(value)) return 'reject';
  if (['defer', 'deferred', 'snooze', 'later'].includes(value)) return 'defer';
  if (['dismiss', 'dismissed', 'discard'].includes(value)) return 'dismiss';
  return value;
}

function statusLabel(ask: any): string {
  const priority = ask.priority === 'high' ? '!' : ask.priority === 'low' ? '-' : ' ';
  const assignee = ask.assigned_to || ask.owner_kind || 'room';
  return `[${ask.id}]${priority} ${ask.status.padEnd(9)} ${String(assignee).padEnd(10)} ${ask.title}`;
}

function printAsk(ask: any) {
  console.log(statusLabel(ask));
  if (ask.session_name || ask.session_id) console.log(`Room: ${ask.session_name || ask.session_id} (${ask.session_id})`);
  if (ask.body) console.log(`Context: ${ask.body}`);
  if (ask.recommendation) console.log(`Recommend: ${ask.recommendation}`);
  if (ask.answer) console.log(`Answer: ${ask.answer}`);
  if (ask.source_message_id) console.log(`Source message: ${ask.source_message_id}`);
}

async function listAsks(args: string[], flags: any, ctx: any) {
  const maybeSession = args[1] && !String(args[1]).startsWith('-') ? args[1] : flags.session || flags.room || flags.session_id;
  const params = new URLSearchParams();
  params.set('status', String(flags.status || ACTIVE_STATUS));
  params.set('limit', String(flags.limit || 100));
  if (maybeSession) params.set('session_id', String(maybeSession));
  if (flags.to || flags.assigned || flags.assigned_to) params.set('assigned_to', String(flags.to || flags.assigned || flags.assigned_to));

  const path = maybeSession
    ? `/api/sessions/${maybeSession}/asks?${params.toString()}`
    : `/api/asks?${params.toString()}`;
  const data = await api.get(ctx, path, roomOpts(maybeSession));
  const asks = data.asks || [];
  if (ctx.json) { console.log(JSON.stringify(asks)); return; }
  if (asks.length === 0) {
    console.log('No active asks.');
    return;
  }
  for (const ask of asks) console.log(statusLabel(ask));
}

async function showAsk(askId: string, flags: any, ctx: any) {
  const sessionId = flags.session || flags.room || flags.session_id;
  const path = sessionId ? `/api/sessions/${sessionId}/asks/${askId}` : `/api/asks/${askId}`;
  const data = await api.get(ctx, path, roomOpts(sessionId));
  if (ctx.json) { console.log(JSON.stringify(data.ask)); return; }
  printAsk(data.ask);
}

async function createAsk(sessionId: string, title: string, flags: any, ctx: any) {
  if (!sessionId || !title) {
    throw new Error('Usage: ant ask create <room-id> "question" [--body "..."] [--recommend "..."] [--to @handle]');
  }
  const assignee = flags.to || flags.assigned || flags.assigned_to || flags.audience;
  const ownerKind = flags.owner || flags.owner_kind || flags.kind || (assignee ? 'agent' : 'room');
  const payload = {
    session_id: sessionId,
    title,
    body: flags.body || flags.context || '',
    recommendation: flags.recommend || flags.recommendation || null,
    assigned_to: assignee || ownerKind || 'room',
    owner_kind: ownerKind,
    priority: flags.priority || 'normal',
    created_by: resolveIdentity(!!flags.external),
    meta: { source: 'cli_ask' },
  };
  const data = await api.post(ctx, `/api/sessions/${sessionId}/asks`, payload, roomOpts(sessionId));
  if (ctx.json) { console.log(JSON.stringify(data.ask)); return; }
  console.log(`Ask opened: ${statusLabel(data.ask)}`);
}

async function answerAsk(askId: string, rawAction: string, flags: any, ctx: any, args: string[]) {
  if (!askId) throw new Error('Usage: ant ask answer <ask-id> approve|reject|defer|dismiss --msg "..."');
  const action = actionFrom(rawAction || flags.action);
  const sessionId = flags.session || flags.room || flags.session_id;
  const answer = pickText(args, 3, flags) || flags.why || flags.reason || '';
  const path = sessionId ? `/api/sessions/${sessionId}/asks/${askId}` : `/api/asks/${askId}`;
  const data = await api.patch(ctx, path, {
    action,
    answer,
    answered_by: resolveIdentity(!!flags.external),
  }, roomOpts(sessionId));
  if (ctx.json) { console.log(JSON.stringify(data.ask)); return; }
  console.log(`Ask ${data.ask.id}: ${data.ask.status}${data.ask.answer_action ? ` (${data.ask.answer_action})` : ''}`);
}

async function nudgeAsk(askId: string, flags: any, ctx: any) {
  if (!askId) {
    throw new Error('Usage: ant ask nudge <ask-id> [--dry-run]');
  }
  const sessionId = flags.session || flags.room || flags.session_id;
  const askPath = sessionId ? `/api/sessions/${sessionId}/asks/${askId}` : `/api/asks/${askId}`;
  const data = await api.get(ctx, askPath, roomOpts(sessionId));
  const ask = data.ask;
  if (!ask) throw new Error(`Ask ${askId} not found`);
  const snippet = buildNudgeSnippet(ask);
  if (flags.dry || flags['dry-run']) {
    console.log(snippet);
    return;
  }
  const roomId = ask.session_id;
  if (!roomId) {
    throw new Error(`Ask ${askId} has no session_id; cant nudge a roomless ask. Use --dry-run to print the snippet.`);
  }
  const post = await api.post(ctx, `/api/sessions/${roomId}/messages`, {
    role: 'system',
    content: snippet,
    format: 'text',
    msg_type: 'ask_nudge',
    sender_id: resolveIdentity(!!flags.external),
    target: ask.assigned_to || null,
    meta: { ask_id: ask.id, source: 'cli_ask_nudge' },
  }, roomOpts(roomId));
  if (ctx.json) { console.log(JSON.stringify({ ask_id: ask.id, room_id: roomId, message_id: post.id })); return; }
  console.log(`Nudge posted in room ${ask.session_name || roomId} (msg ${post.id}).`);
}

async function outstandingAsks(flags: any, ctx: any) {
  const params = new URLSearchParams();
  params.set('status', String(flags.status || ACTIVE_STATUS));
  params.set('limit', String(flags.limit || 50));
  if (flags.to || flags.assigned || flags.assigned_to) {
    params.set('assigned_to', String(flags.to || flags.assigned || flags.assigned_to));
  }
  const data = await api.get(ctx, `/api/asks?${params.toString()}`);
  const asks = data.asks || [];
  if (ctx.json) { console.log(JSON.stringify(asks)); return; }
  if (asks.length === 0) {
    console.log('No outstanding asks.');
    return;
  }
  for (const ask of asks) {
    console.log(buildNudgeSnippet(ask, { addressedTo: flags.to || flags.assigned_to || null }));
    console.log('');
  }
}

export async function ask(args: string[], flags: any, ctx: any) {
  const sub = args[0] || 'list';

  if (sub === 'nudge' || sub === 'remind') {
    await nudgeAsk(args[1], flags, ctx);
    return;
  }

  if (sub === 'outstanding' || sub === 'pending' || sub === 'queue') {
    await outstandingAsks(flags, ctx);
    return;
  }

  if (sub === 'list' || sub === 'ls') {
    await listAsks(args, flags, ctx);
    return;
  }

  if (sub === 'show') {
    await showAsk(args[1], flags, ctx);
    return;
  }

  if (sub === 'create' || sub === 'open') {
    await createAsk(args[1], pickText(args, 2, flags), flags, ctx);
    return;
  }

  if (sub === 'answer' || sub === 'respond' || sub === 'resolve') {
    await answerAsk(args[1], args[2], flags, ctx, args);
    return;
  }

  if (sub === 'defer' || sub === 'dismiss' || sub === 'approve' || sub === 'reject') {
    await answerAsk(args[1], sub, flags, ctx, args);
    return;
  }

  if (ASK_ID_RE.test(sub)) {
    await showAsk(sub, flags, ctx);
    return;
  }

  if (args.length >= 2 || flags.question || flags.msg) {
    await createAsk(sub, pickText(args, 1, flags), flags, ctx);
    return;
  }

  await listAsks(['list', sub], flags, ctx);
}
