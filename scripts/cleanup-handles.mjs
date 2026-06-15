#!/usr/bin/env node
/**
 * cleanANT cleanup — delete/anonymise every ANThandle that is NOT one of the
 * live desks' handles (the operator's "no handles in use other than the 6"
 * goal, aggressive interpretation). Run AFTER mining and AFTER the desk
 * cleanup, inside the backup window.
 *
 * Keep-set (never touched):
 *   - the operator handle (getOperatorHandle, @JWPK)
 *   - reserved system handles (data/reserved-handles.json)
 *   - the handles carried by the currently-live tmux desks
 * Everything else with lifecycle != 'deleted' is anonymised via deleteHandle:
 *   chat posts/reactions → [A#], member/lease lists → [A-#], name freed, the
 *   act ledgered. Original → [A#] mapping stays in identity_ledger forever.
 *
 * Run with tsx so the TS lifecycle code is importable:
 *   npx tsx scripts/cleanup-handles.mjs --dry-run
 *   npx tsx scripts/cleanup-handles.mjs --commit
 *
 * Exit codes: 0 ok / 1 bad usage.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function canon(raw) {
  return '@' + String(raw).trim().replace(/^@+/, '');
}

export function loadReserved() {
  for (const p of [
    join(process.cwd(), 'data', 'reserved-handles.json'),
    resolve(__dirname, '../data/reserved-handles.json')
  ]) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')).filter((h) => typeof h === 'string');
  }
  return [];
}

export function liveTmuxSessions(runner = defaultTmuxRunner) {
  return new Set(
    runner()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}
function defaultTmuxRunner() {
  try {
    return execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

/**
 * The lowercase canonical keep-set: operator + reserved + every handle borne by
 * a live tmux desk. Pure over the passed db.
 */
export function computeKeepSet(db, liveSet, reserved, operatorHandle) {
  const keep = new Set();
  keep.add(canon(operatorHandle).toLowerCase());
  for (const h of reserved) keep.add(canon(h).toLowerCase());
  const live = [...liveSet];
  if (live.length > 0) {
    const placeholders = live.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT DISTINCT handle FROM terminal_records
          WHERE handle IS NOT NULL AND handle <> '' AND session_id IN (${placeholders})`
      )
      .all(...live);
    for (const r of rows) keep.add(canon(r.handle).toLowerCase());
  }
  return keep;
}

/**
 * Every non-deleted handle that is NOT in the keep-set, with its chat-post
 * count (the anonymisation blast radius). Pure over the passed db.
 */
export function selectDeleteHandles(db, keepSet) {
  const rows = db
    .prepare(`SELECT handle, lifecycle FROM handles WHERE lifecycle IS NULL OR lifecycle <> 'deleted'`)
    .all();
  return rows
    .map((r) => canon(r.handle))
    .filter((h) => !keepSet.has(h.toLowerCase()))
    .map((h) => ({
      handle: h,
      posts: (db.prepare(`SELECT COUNT(*) AS n FROM chat_messages WHERE author_handle = ?`).get(h)).n
    }))
    .sort((a, b) => b.posts - a.posts);
}

async function main() {
  const mode = process.argv.includes('--commit')
    ? '--commit'
    : process.argv.includes('--dry-run')
      ? '--dry-run'
      : null;
  if (!mode) {
    console.error('Usage: npx tsx scripts/cleanup-handles.mjs --dry-run | --commit');
    process.exit(1);
  }
  const commit = mode === '--commit';

  const { getIdentityDb } = await import('../src/lib/server/db.ts');
  const { deleteHandle } = await import('../src/lib/server/handleLifecycle.ts');
  const { getOperatorHandle } = await import('../src/lib/server/operatorHandle.ts');

  const db = getIdentityDb();
  const liveSet = liveTmuxSessions();
  const reserved = loadReserved();
  const operator = getOperatorHandle();
  const keepSet = computeKeepSet(db, liveSet, reserved, operator);
  const targets = selectDeleteHandles(db, keepSet);

  console.log(`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`);
  console.log(`Live tmux: ${liveSet.size} | keep-set (operator+reserved+live-desk handles): ${keepSet.size}`);
  console.log(`KEEP: ${[...keepSet].sort().join(', ')}`);
  console.log(`\nDELETE/ANONYMISE ${targets.length} handles (posts = chat messages that will be rewritten to [A#]):`);
  let totalPosts = 0;
  for (const t of targets) {
    totalPosts += t.posts;
    console.log(`  ${t.handle.padEnd(28)} ${t.posts} posts`);
  }
  console.log(`\nTotal posts to anonymise: ${totalPosts}`);

  if (!commit) {
    console.log(`\nDry-run — re-run with --commit to anonymise the ${targets.length} handles above.`);
    return;
  }
  let n = 0;
  for (const t of targets) {
    const res = deleteHandle(t.handle, { reason: 'cleanANT pre-launch handle cleanup', actor: operator });
    n++;
    console.log(`  ✓ ${t.handle} → [A${res.anonId}] (${res.chatPostsAnonymised} posts, ${res.reactionsAnonymised} reactions)`);
  }
  console.log(`\nCommitted: ${n} handles anonymised.`);
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
