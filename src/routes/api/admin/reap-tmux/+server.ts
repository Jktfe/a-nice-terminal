// POST /api/admin/reap-tmux — kill any tmux session not backed by a live ANT
// terminal row. Backs the Settings → Maintenance "Clean up tmux sessions"
// button, and is also fired once at server boot so launchd restarts sweep
// up zombies left behind by previous generations.
//
// Policy lives here, not in pty-daemon: we read the DB to decide which
// session ids are "alive", then hand the keep-set to the daemon. The daemon
// runs the kill and replies with what it actually reaped.

import { json } from '@sveltejs/kit';
import getDb from '$lib/server/db';
import { ptyClient } from '$lib/server/pty-client';

export async function POST() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id FROM sessions
     WHERE type = 'terminal'
       AND archived = 0
       AND deleted_at IS NULL
       AND status NOT IN ('archived', 'deleted', 'closed')`
  ).all() as Array<{ id: string }>;
  const knownIds = rows.map((r) => r.id);

  const killed = await ptyClient.reapOrphans(knownIds);
  return json({ killed, killedCount: killed.length, knownCount: knownIds.length });
}
