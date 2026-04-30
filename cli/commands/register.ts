import { api } from '../lib/api.js';
import { normalizeHandle, pidStart, processIdentityChain } from '../lib/identity.js';

function parseTtlSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(60, Math.floor(value));
  if (typeof value !== 'string') return 12 * 60 * 60;
  const raw = value.trim().toLowerCase();
  const match = raw.match(/^(\d+)(s|m|h)?$/);
  if (!match) return 12 * 60 * 60;
  const amount = Number(match[1]);
  const unit = match[2] || 's';
  return Math.max(60, unit === 'h' ? amount * 3600 : unit === 'm' ? amount * 60 : amount);
}

export async function register(args: string[], flags: any, ctx: any) {
  const handleInput = typeof flags.handle === 'string' ? flags.handle : args.find((arg) => arg.startsWith('@'));
  const sessionId = typeof flags.session === 'string' ? flags.session.trim() : '';
  const handle = handleInput ? normalizeHandle(handleInput) : '';
  if (!handle && !sessionId) {
    console.error('Usage: ant register --handle @name [--ttl 12h] [--pid <pid>]');
    return;
  }

  const rootPid = Number(flags.pid || process.ppid);
  const pids = flags.chain
    ? processIdentityChain(rootPid)
    : [{ pid: rootPid, pid_start: pidStart(rootPid) }];
  if (pids.length === 0) {
    console.error('Could not determine a stable parent PID to register.');
    return;
  }

  const result = await api.post(ctx, '/api/identity/register', {
    pids,
    handle: handle || undefined,
    session_id: sessionId || undefined,
    ttl_seconds: parseTtlSeconds(flags.ttl || flags.duration),
    source: 'cli-register',
    meta: { cwd: process.cwd() },
  });

  if (ctx.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const identity = result.identity || {};
  const count = Array.isArray(result.identities) ? result.identities.length : 1;
  const expires = identity.expires_at ? new Date(identity.expires_at * 1000).toISOString() : 'unknown expiry';
  console.log(`Registered ${identity.handle || identity.session_id} for ${count} process-tree pid${count === 1 ? '' : 's'} until ${expires}`);
}
