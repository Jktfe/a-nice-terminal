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
// FREE = waiting/available only (aligned with queueConsumer's FREE_LABELS;
// adversarial review L2 — 'idle' was the post-delivery state that fed the H2 race).
const isFree = (st) => !!st && ['waiting', 'available'].includes(st.toLowerCase());
const isBusy = (st) => !!st && ['working', 'thinking', 'busy'].includes(st.toLowerCase());
// H2 dwell guard: only mark a 'working' item done once we've OBSERVED the chair
// go busy since delivery (it actually started it) and then come free — or a
// max-dwell fallback elapsed (state-reporting lag / a model faster than a tick).
const MAX_DWELL_MS = Number(flag('max-dwell', '180')) * 1000;
let observedBusySinceDelivery = false;

function deliverToPane(text) {
  if (!LIVE) { log('[dry-run] would send to', PANE, '→', JSON.stringify(text.slice(0, 80))); return; }
  const needsNewlineStrip = [
    'pi',
    'qwen',
    'qwen-cli',
    'antigravity',
    'agy',
    'copilot',
    'copilot-cli',
    'github-copilot-cli'
  ].includes(STATE_CLI);
  const deliveredText = needsNewlineStrip ? text.replace(/\r?\n/g, ' ') : text;
  execFileSync('tmux', ['-L', TMUX_SOCKET, 'send-keys', '-t', PANE, deliveredText]);
  execFileSync('tmux', ['-L', TMUX_SOCKET, 'send-keys', '-t', PANE, 'Enter']);
  log('[live] sent to', PANE);
}

async function tick() {
  const st = chairState();
  const free = isFree(st);
  const items = (await api('GET', `?handle=${encodeURIComponent(HANDLE)}`)).items ?? [];
  const working = items.find((i) => i.status === 'working');
  const pending = items.filter((i) => i.status === 'pending');
  if (isBusy(st)) observedBusySinceDelivery = true; // the chair actually started the item
  log(`chair=${st ?? 'unknown'} free=${free} | pending=${pending.length} working=${working ? 1 : 0}${working ? ` observedBusy=${observedBusySinceDelivery}` : ''}`);

  // 1. An item is in flight ('working'). Mark it done ONLY when the chair is
  //    free AND we've seen it go busy since delivery (H2: a local model that
  //    hasn't flipped to 'working' yet still reads free — marking done then
  //    skips the item). Fallback: if it's been working > MAX_DWELL with no
  //    observed-busy (state lag / very fast model), release anyway.
  if (working) {
    const dwellMs = Date.now() - (working.updatedAtMs ?? Date.now());
    const finished = free && (observedBusySinceDelivery || dwellMs >= MAX_DWELL_MS);
    if (finished) {
      if (LIVE) await api('PATCH', `/${working.id}`, { status: 'done' });
      log(`${LIVE ? 'marked' : '[dry-run] would mark'} done:`, working.id, observedBusySinceDelivery ? '(observed busy→free)' : '(max-dwell fallback)');
      observedBusySinceDelivery = false;
    }
    return; // hold while in flight (one-in-flight back-pressure)
  }
  if (!free) return;                 // busy, nothing claimed yet → hold
  if (pending.length === 0) return;  // empty → (cron would fill here)

  // 2. Curate (also reclaims stuck-working), then release ONE.
  if (!LIVE) {
    log('[dry-run] would curate + pull + deliver next:', JSON.stringify(pending[0].curatedText.slice(0, 60)));
    return; // dry-run is side-effect-free (adversarial review L1): no curate/pull/patch
  }
  try { const s = await api('POST', '/curate', { targetHandle: HANDLE }); log('curated:', JSON.stringify(s)); } catch (e) { log('curate skipped:', e.message); }
  const pulled = (await api('POST', '/pull', { targetHandle: HANDLE })).item;
  if (!pulled) return;
  observedBusySinceDelivery = false;
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
