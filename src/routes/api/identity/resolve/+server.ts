import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

type PidEntry = { pid: number; pid_start: string | null };

function cleanPidChain(value: unknown): PidEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): PidEntry | null => {
      if (typeof entry === 'number') {
        if (!Number.isInteger(entry) || entry <= 1) return null;
        return { pid: entry, pid_start: null };
      }
      if (!entry || typeof entry !== 'object') return null;
      const pid = Number((entry as any).pid);
      if (!Number.isInteger(pid) || pid <= 1) return null;
      const rawStart = (entry as any).pid_start;
      const pidStart = typeof rawStart === 'string' ? rawStart.trim() || null : null;
      return { pid, pid_start: pidStart };
    })
    .filter((entry): entry is PidEntry => entry !== null)
    .slice(0, 64);
}

export async function POST({ request }: RequestEvent) {
  const body = await request.json().catch(() => ({}));
  const pids = cleanPidChain(body.pids);
  if (pids.length === 0) {
    return json({ error: 'pids must be a non-empty array' }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  queries.pruneTerminalIdentities(now);
  const row = queries.resolveTerminalIdentity(pids, now) as any;
  if (!row) {
    return json({ identity: null });
  }

  const handle = row.session_handle || row.handle || null;
  return json({
    identity: {
      sender_id: row.session_id || handle,
      handle,
      display_name: row.display_name || row.name || null,
      session_id: row.session_id || null,
      pid: row.root_pid,
      pid_start: row.pid_start || null,
      source: row.source || 'manual',
      registered_at: row.registered_at,
      expires_at: row.expires_at,
    },
  });
}
