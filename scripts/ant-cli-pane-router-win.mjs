#!/usr/bin/env bun
/**
 * ant-cli-pane-router-win.mjs — bridge xenoANT room messages into a
 * WezTerm pane on this Windows box.
 *
 * Spawns `ant chat tail --room <id> --json` as a subprocess, parses each
 * polled message, filters @-mentions targeting MY_HANDLE or @everyone,
 * suppresses the bot's own messages and dupes, then injects via
 * `wezterm cli send-text --pane-id <id> --no-paste`.
 *
 *   bun scripts/ant-cli-pane-router-win.mjs \
 *     --room 8x31p1ot40 --handle @xenoCC --pane-id "$WEZTERM_PANE"
 *
 * Defaults pulled from env (WEZTERM_PANE, ANT_HANDLE). All flags can be
 * overridden on the CLI.
 *
 * Knowledge encoded here from the prior wezwatch.ts iteration (memory:
 * feedback_node_pty_bun_windows):
 *   - node-pty is broken on Bun+Windows; `wezterm cli send-text` works.
 *   - Two-call write pattern: text first, then \r ~150ms later. The
 *     single-write "text\n" path is unreliable for Claude Code mid-
 *     session on Windows.
 *   - Self-broadcast suppression via a `mySenders` set, BEFORE per-
 *     message filtering (an @-mention sent by *us* must not loop back).
 *   - Dedup by message id so a slow poll cycle doesn't double-fire.
 *
 * Output target is the CURRENT pane unless --pane-id is set. Inside a
 * WezTerm session WEZTERM_PANE is exported automatically.
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

// ---------- args + env ---------------------------------------------------

const args = process.argv.slice(2);
function flag(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}

const ROOM = flag('room');
if (!ROOM) {
  process.stderr.write('usage: bun ant-cli-pane-router-win.mjs --room <id> [--handle @name] [--pane-id N] [--cli ant] [--poll-ms 2000]\n');
  process.exit(2);
}
const HANDLE = flag('handle', process.env.ANT_HANDLE || '@xenoCC');
const PANE_ID = flag('pane-id', process.env.WEZTERM_PANE || '0');
const CLI = flag('cli', 'ant');
const POLL_MS = flag('poll-ms', '2000');
const WEZTERM_EXE = process.env.WEZTERM_EXECUTABLE || 'wezterm';
const HANDLE_LC = HANDLE.toLowerCase();
const MY_SENDERS = new Set([HANDLE_LC]);

// ---------- logging ------------------------------------------------------

function log(...a) {
  const ts = new Date().toISOString().slice(11, 19);
  process.stderr.write(`[${ts} router] ${a.join(' ')}\n`);
}

// ---------- filtering ----------------------------------------------------

const seenIds = new Set();
const SEEN_CAP = 5000;

function shouldRoute(msg) {
  if (!msg || typeof msg !== 'object') return false;
  const id = msg.id ?? msg.messageId ?? null;
  const authorHandle = (msg.authorHandle ?? msg.handle ?? '').toLowerCase();
  const body = msg.body ?? msg.text ?? '';
  if (!authorHandle || !body) return false;

  // Self-broadcast suppression first — never route our own posts back
  if (MY_SENDERS.has(authorHandle)) return false;

  // Targeted? @<my-handle> or @everyone
  const targeted =
    body.toLowerCase().includes(HANDLE_LC) ||
    /@everyone\b/i.test(body);
  if (!targeted) return false;

  // Dedup
  if (id) {
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    if (seenIds.size > SEEN_CAP) {
      // Trim oldest by reconstructing from last half — cheap, infrequent
      const arr = Array.from(seenIds);
      seenIds.clear();
      for (const x of arr.slice(arr.length / 2)) seenIds.add(x);
    }
  }
  return true;
}

// ---------- wezterm injection -------------------------------------------

function wezSend(text, opts = {}) {
  return new Promise((resolve, reject) => {
    const args = ['cli', 'send-text', '--pane-id', String(PANE_ID)];
    if (opts.noPaste !== false) args.push('--no-paste');
    const proc = spawn(WEZTERM_EXE, args, { stdio: ['pipe', 'inherit', 'inherit'] });
    proc.on('error', reject);
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`wezterm cli send-text exit ${code}`))));
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

async function injectMessage(msg) {
  const payload = `[antchat xenoANT from ${msg.authorHandle ?? msg.handle}] ${msg.body ?? msg.text}`;
  log(`inject -> pane ${PANE_ID}: ${payload.slice(0, 80)}`);
  try {
    await wezSend(payload);
    await sleep(150);
    await wezSend('\r');
  } catch (err) {
    log(`inject FAILED: ${err.message}`);
  }
}

// ---------- subprocess: ant chat tail --json ----------------------------

function spawnTail() {
  const tailArgs = ['chat', 'tail', '--room', ROOM, '--json', '--poll-ms', String(POLL_MS)];
  log(`spawn: ${CLI} ${tailArgs.join(' ')}`);
  const child = spawn(CLI, tailArgs, { stdio: ['ignore', 'pipe', 'inherit'] });
  child.on('error', err => log(`spawn error: ${err.message}`));
  return child;
}

let consecutiveFailures = 0;
const PERMANENT_FAIL_AFTER = 5;

async function runForever() {
  while (true) {
    const child = spawnTail();
    let buf = '';
    let receivedAny = false;

    await new Promise(resolve => {
      child.stdout.on('data', chunk => {
        receivedAny = true;
        buf += chunk.toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let msg;
          try {
            msg = JSON.parse(trimmed);
          } catch {
            // Tolerant: non-JSON line (e.g. a warning) — ignore
            continue;
          }
          if (shouldRoute(msg)) {
            // Fire-and-forget — injections must not block the stream
            injectMessage(msg).catch(err => log(`inject error: ${err.message}`));
          }
        }
      });
      child.on('close', code => {
        log(`tail subprocess exit ${code}`);
        resolve();
      });
    });

    if (receivedAny) consecutiveFailures = 0;
    else consecutiveFailures++;

    if (consecutiveFailures >= PERMANENT_FAIL_AFTER) {
      log(`gave up after ${consecutiveFailures} consecutive empty tail invocations`);
      process.exit(1);
    }

    const backoff = Math.min(30_000, 1000 * 2 ** Math.min(consecutiveFailures, 5));
    log(`backoff ${backoff}ms before respawn`);
    await sleep(backoff);
  }
}

// ---------- entry -------------------------------------------------------

log(`router starting: room=${ROOM} handle=${HANDLE} pane=${PANE_ID} cli=${CLI}`);
runForever().catch(err => {
  log(`fatal: ${err.message}`);
  process.exit(1);
});
