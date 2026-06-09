#!/usr/bin/env node
/**
 * curated-queue-poller.mjs — the runtime release loop for the curated chair queue.
 *
 * The capacity gate, live: it curates the queue, and releases ONE item to the
 * chair's pane only when the chair is FREE (one-in-flight). An HTTP client over
 * the queue API (no better-sqlite3 → runs on node OR bun), reads the chair's
 * state from ~/.ant/state/pi/, and delivers via tmux send-keys.
 *
 * SAFE BY DEFAULT: --dry-run (the default) logs what it WOULD do and never
 * touches the live pane. Pass --live to actually drive the chair (the go-live
 * step). Pass --once to run a single tick instead of looping.
 *
 * Usage:
 *   node scripts/curated-queue-poller.mjs --room <ROOM> --handle @localchair \
 *        --pane t_i83p2t5sqr:0.0 [--server http://localhost:6174] \
 *        [--state-cli pi] [--interval 8] [--live] [--once]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);

const SERVER = flag('server', 'http://localhost:6174').replace(/\/$/, '');
const ROOM = flag('room', null);
const HANDLE = flag('handle', '@localchair');
const PANE = flag('pane', null);          // tmux target, e.g. t_i83p2t5sqr:0.0
const STATE_CLI = flag('state-cli', 'pi'); // ~/.ant/state/<cli>/
const INTERVAL = Number(flag('interval', '8')) * 1000;
const TMUX_SOCKET = flag('tmux-socket', 'default');
const LIVE = has('live');
const ONCE = has('once');
const FRESH_MS = 90_000; // a state file older than this = stale (chair likely gone)

if (!ROOM) { console.error('--room is required'); process.exit(1); }
if (LIVE && !PANE) { console.error('--live requires --pane'); process.exit(1); }

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function api(method, path, body) {
  const r = await fetch(`${SERVER}/api/chat-rooms/${ROOM}/queue${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}`);
  return r.json();
}

/** Read the chair's freshest pi state file; return its state label or null. */
function chairState() {
  try {
    const dir = join(homedir(), '.ant', 'state', STATE_CLI);
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    let best = null;
    for (const f of files) {
      const p = join(dir, f);
      const m = statSync(p).mtimeMs;
      if (!best || m > best.m) best = { p, m };
    }
    if (!best || Date.now() - best.m > FRESH_MS) return null; // stale/none
    const s = JSON.parse(readFileSync(best.p, 'utf8'));
    return typeof s.state === 'string' ? s.state : null;
  } catch {
    return null;
  }
}
const isFree = (st) => !!st && ['waiting', 'available', 'idle'].includes(st.toLowerCase());

function deliverToPane(text) {
  if (!LIVE) { log('[dry-run] would send to', PANE, '→', JSON.stringify(text.slice(0, 80))); return; }
  execFileSync('tmux', ['-L', TMUX_SOCKET, 'send-keys', '-t', PANE, text]);
  execFileSync('tmux', ['-L', TMUX_SOCKET, 'send-keys', '-t', PANE, 'Enter']);
  log('[live] sent to', PANE);
}

async function tick() {
  const st = chairState();
  const free = isFree(st);
  const items = (await api('GET', `?handle=${encodeURIComponent(HANDLE)}`)).items ?? [];
  const working = items.find((i) => i.status === 'working');
  const pending = items.filter((i) => i.status === 'pending');
  log(`chair=${st ?? 'unknown'} free=${free} | pending=${pending.length} working=${working ? 1 : 0}`);

  // 1. Chair free + an item still 'working' → it finished that item → mark done.
  if (free && working) {
    await api('PATCH', `/${working.id}`, { status: 'done' });
    log('marked done (chair finished):', working.id);
    return; // next tick releases the next one
  }
  if (!free) return;            // busy → hold (back-pressure)
  if (working) return;          // one-in-flight guard
  if (pending.length === 0) return; // empty → (cron would fill here)

  // 2. Curate, then release ONE.
  try { const s = await api('POST', '/curate', { targetHandle: HANDLE }); log('curated:', JSON.stringify(s.summary)); } catch (e) { log('curate skipped:', e.message); }
  const pulled = (await api('POST', '/pull', { targetHandle: HANDLE })).item;
  if (!pulled) return;
  log('released:', pulled.id, JSON.stringify(pulled.curatedText.slice(0, 60)));
  deliverToPane(pulled.curatedText);
}

log(`curated-queue-poller | room=${ROOM} handle=${HANDLE} mode=${LIVE ? 'LIVE' : 'DRY-RUN'} ${ONCE ? '(once)' : `every ${INTERVAL / 1000}s`}`);
if (ONCE) {
  await tick().catch((e) => { log('tick error:', e.message); process.exit(1); });
} else {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick().catch((e) => log('tick error:', e.message));
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}
