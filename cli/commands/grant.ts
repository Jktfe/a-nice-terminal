// M3 #3 — Grant lifecycle CLI
//
// ant grant list [--to @handle] [--room <id>] [--status active|revoked|expired]
// ant grant create --topic <topic> --to @handle [--room <id>] [--duration 1h] [--max-answers 5] [--source src1,src2]
// ant grant revoke <grant-id> [--room <id>]
//
// Uses the same DI-friendly shape as ask.ts — calls the server API which
// exercises the real db queries. The server route layer will be added in a
// follow-up; for now, these hit the API directly.

import { api } from '../lib/api.js';
import { config } from '../lib/config.js';

function roomOpts(id?: string): { roomToken?: string } | undefined {
  if (!id) return undefined;
  const t = config.getRoomToken(id);
  return t?.token ? { roomToken: t.token } : undefined;
}

function pickRoom(args: string[], flags: any): string | undefined {
  return flags.room || flags.session || flags.r || args[0];
}

const VALID_TOPICS = ['file-read', 'file-write', 'web-fetch', 'command-exec', 'memory-read', 'memory-write'];
const VALID_STATUSES = ['active', 'revoked', 'expired'];

function formatGrant(g: any): string {
  const statusIcon = g.status === 'active' ? '✓' : g.status === 'revoked' ? '✗' : '⏰';
  const remaining = g.max_answers != null
    ? `${g.answer_count}/${g.max_answers}`
    : `${g.answer_count}/∞`;
  const sources = g.source_set && g.source_set.length > 0
    ? ` sources=${Array.isArray(g.source_set) ? g.source_set.join(',') : g.source_set}`
    : '';
  const expires = g.expires_at_ms
    ? ` expires=${new Date(g.expires_at_ms).toISOString()}`
    : ' expires=never';
  return `[${g.id}] ${statusIcon} ${g.status.padEnd(7)} ${String(g.granted_to).padEnd(12)} topic=${g.topic} uses=${remaining}${expires}${sources}`;
}

async function listGrants(args: string[], flags: any, ctx: any) {
  const roomId = pickRoom(args, flags);
  const params = new URLSearchParams();
  if (flags.to || flags.granted_to) params.set('granted_to', String(flags.to || flags.granted_to));
  if (flags.status && VALID_STATUSES.includes(String(flags.status))) params.set('status', String(flags.status));
  if (flags.topic) params.set('topic', String(flags.topic));

  const path = roomId
    ? `/api/sessions/${roomId}/grants?${params.toString()}`
    : `/api/grants?${params.toString()}`;

  const data = await api.get(ctx, path, roomOpts(roomId));
  const grants = data.grants || [];
  if (ctx.json) { console.log(JSON.stringify(grants)); return; }
  if (grants.length === 0) {
    console.log('No consent grants found.');
    return;
  }
  for (const g of grants) console.log(formatGrant(g));
}

async function createGrant(args: string[], flags: any, ctx: any) {
  const roomId = flags.room || flags.session || flags.r;
  if (!roomId) throw new Error('Usage: ant grant create --room <room-id> --topic <topic> --to @handle');
  const topic = String(flags.topic || '').trim();
  if (!topic) throw new Error('Usage: ant grant create --topic <topic> (file-read|file-write|web-fetch|command-exec|memory-read|memory-write)');
  const grantedTo = String(flags.to || flags.granted_to || '').trim();
  if (!grantedTo) throw new Error('Usage: ant grant create --to @handle');

  const sourceSet = flags.source || flags.sources
    ? String(flags.source || flags.sources).split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];

  const payload = {
    session_id: roomId,
    topic,
    granted_to: grantedTo.startsWith('@') ? grantedTo : `@${grantedTo}`,
    source_set: sourceSet,
    duration: flags.duration || '1h',
    max_answers: flags['max-answers'] || flags.maxAnswers ? Number(flags['max-answers'] || flags.maxAnswers) : null,
  };

  const data = await api.post(ctx, `/api/sessions/${roomId}/grants`, payload, roomOpts(roomId));
  if (ctx.json) { console.log(JSON.stringify(data.grant)); return; }
  const g = data.grant;
  console.log(`Grant created: ${formatGrant(g)}`);
}

async function revokeGrant(args: string[], flags: any, ctx: any) {
  const grantId = args[0];
  if (!grantId) throw new Error('Usage: ant grant revoke <grant-id> [--room <room-id>]');
  const roomId = flags.room || flags.session || flags.r;

  const path = roomId
    ? `/api/sessions/${roomId}/grants/${grantId}/revoke`
    : `/api/grants/${grantId}/revoke`;

  const data = await api.post(ctx, path, {}, roomOpts(roomId));
  if (ctx.json) { console.log(JSON.stringify(data.grant)); return; }
  const g = data.grant;
  if (g.status === 'revoked') {
    console.log(`Grant ${g.id} revoked.`);
  } else {
    console.log(`Grant ${g.id}: status=${g.status} (expected 'revoked')`);
  }
}

async function showGrant(args: string[], flags: any, ctx: any) {
  const grantId = args[0];
  if (!grantId) throw new Error('Usage: ant grant show <grant-id> [--room <room-id>]');
  const roomId = flags.room || flags.session || flags.r;

  const path = roomId
    ? `/api/sessions/${roomId}/grants/${grantId}`
    : `/api/grants/${grantId}`;

  const data = await api.get(ctx, path, roomOpts(roomId));
  if (ctx.json) { console.log(JSON.stringify(data.grant)); return; }
  console.log(formatGrant(data.grant));
}

export async function grant(args: string[], flags: any, ctx: any) {
  const sub = args[0] || 'list';

  if (sub === 'list' || sub === 'ls') {
    await listGrants(args.slice(1), flags, ctx);
    return;
  }

  if (sub === 'show') {
    await showGrant(args.slice(1), flags, ctx);
    return;
  }

  if (sub === 'create' || sub === 'add' || sub === 'open') {
    await createGrant(args.slice(1), flags, ctx);
    return;
  }

  if (sub === 'revoke' || sub === 'cancel' || sub === 'close') {
    await revokeGrant(args.slice(1), flags, ctx);
    return;
  }

  // Default: try to show if it looks like a grant ID
  await listGrants(args, flags, ctx);
}
