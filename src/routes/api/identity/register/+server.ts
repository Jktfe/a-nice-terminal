import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { queries } from '$lib/server/db';

function normalizeHandle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function ttlSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(60, Math.min(Math.floor(value), 24 * 60 * 60));
  }
  if (typeof value !== 'string') return 12 * 60 * 60;
  const raw = value.trim().toLowerCase();
  const match = raw.match(/^(\d+)(s|m|h)?$/);
  if (!match) return 12 * 60 * 60;
  const amount = Number(match[1]);
  const unit = match[2] || 's';
  const seconds = unit === 'h' ? amount * 3600 : unit === 'm' ? amount * 60 : amount;
  return Math.max(60, Math.min(seconds, 24 * 60 * 60));
}

function cleanPidEntries(body: any): { pid: number; pid_start: string | null }[] {
  if (Array.isArray(body?.pids)) {
    const seen = new Set<number>();
    return body.pids
      .map((entry: any) => {
        const pid = Number(typeof entry === 'number' ? entry : entry?.pid);
        if (!Number.isInteger(pid) || pid <= 1 || seen.has(pid)) return null;
        seen.add(pid);
        return {
          pid,
          pid_start: cleanString(entry?.pid_start),
        };
      })
      .filter((entry: { pid: number; pid_start: string | null } | null): entry is { pid: number; pid_start: string | null } => !!entry)
      .slice(0, 64);
  }

  const rootPid = Number(body.root_pid ?? body.pid);
  if (!Number.isInteger(rootPid) || rootPid <= 1) return [];
  return [{ pid: rootPid, pid_start: cleanString(body.pid_start) }];
}

export async function POST({ request }: RequestEvent) {
  const body = await request.json().catch(() => ({}));
  const pids = cleanPidEntries(body);
  if (pids.length === 0) {
    return json({ error: 'root_pid or pids must include an integer greater than 1' }, { status: 400 });
  }

  const sessionId = cleanString(body.session_id);
  const session = sessionId ? queries.getSession(sessionId) as any : null;
  if (sessionId && !session) {
    return json({ error: 'session_id not found' }, { status: 404 });
  }

  const handle = normalizeHandle(body.handle) || session?.handle || null;
  if (!handle && !sessionId) {
    return json({ error: 'handle or session_id required' }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttlSeconds(body.ttl_seconds ?? body.ttl ?? body.duration);
  const source = cleanString(body.source) || 'manual';
  const meta = typeof body.meta === 'object' && body.meta !== null ? JSON.stringify(body.meta) : '{}';

  queries.pruneTerminalIdentities(now);
  const identities = pids.map((entry) => {
    const id = nanoid();
    queries.registerTerminalIdentity(
      id,
      entry.pid,
      entry.pid_start,
      handle,
      sessionId,
      source,
      expiresAt,
      meta,
    );
    return {
      id,
      root_pid: entry.pid,
      pid_start: entry.pid_start,
      handle,
      session_id: sessionId,
      source,
      registered_at: now,
      expires_at: expiresAt,
    };
  });

  return json({
    ok: true,
    identity: identities[0],
    identities,
  }, { status: 201 });
}
