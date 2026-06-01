/**
 * ptyClient — v4-native terminal control via direct tmux invocations.
 *
 * No external daemon. No Unix socket round-trip. The v4 SvelteKit process
 * spawns tmux directly via execFile; tmux's own server (a separate OS
 * process) hosts the sessions, so v4 server restarts don't kill terminals.
 *
 * Output capture: each session has `tmux pipe-pane` writing to
 * ~/.ant/pty/<sessionId>.out. A single fs.watch on that directory drives
 * the subscribeOutput callback for all subscribers. Per-file read offsets
 * tracked in-memory so each chunk is emitted exactly once.
 *
 * The exported API is byte-compatible with the previous Unix-socket
 * client — all route handlers + the run-events persistence boot continue
 * to work unchanged.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, openSync, readSync, closeSync, existsSync, readdirSync, statSync, watch as fsWatch, type Stats } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

const execFile = promisify(execFileCb);

const TMUX = '/opt/homebrew/bin/tmux';
const ANT_DIR = join(process.env.HOME || '/tmp', '.ant');
const PTY_DIR = join(ANT_DIR, 'pty');

type OutputCb = (sessionId: string, data: string) => void;
/** Fired when a session's .out file is truncated/rotated/replaced — i.e. the
 *  byte stream is no longer a pure append of what we already read. Consumers
 *  react by repainting (SSE re-seeds scrollback) or dropping stitch state
 *  (persistence boot clears its interactive buffer). */
type ResetCb = (sessionId: string) => void;
type SpawnResult = { alive: boolean; scrollback?: string };

interface State {
  outputCbs: Set<OutputCb>;
  /** Subscribers to truncation/rotation reset events. */
  resetCbs: Set<ResetCb>;
  /** Per-session byte offset already emitted from its .out file. */
  fileOffsets: Map<string, number>;
  /** Per-session inode of the .out file at last read. A change means the file
   *  was replaced (rotation) even if the size didn't shrink. 0 = unknown. */
  fileInodes: Map<string, number>;
  /** Per-session UTF-8 decoder. Holds trailing incomplete multi-byte bytes
   *  across reads so a code point split by the 120ms poll boundary isn't
   *  mangled into U+FFFD. One decoder per session, reused across drains.
   *  Mirrors the StringDecoder pattern already used in pi/piAdapter.ts. */
  decoders: Map<string, StringDecoder>;
  /** fs.watch handle for the PTY_DIR (single watcher; lazy-initialised). */
  dirWatcher: ReturnType<typeof fsWatch> | null;
  watcherBooted: boolean;
  /** Polling fallback timer — macOS fs.watch silently misses appends to
   *  existing files (FSEvents coalescing). The poll stats every known
   *  session-file periodically so live shell output reliably reaches
   *  SSE subscribers even when the watcher dropped the event. */
  pollTimer: ReturnType<typeof setInterval> | null;
  /** Per-session input queue tail: each writeInput chains onto the
   *  previous promise so all tmux send-keys subprocesses for one session
   *  run in arrival order. Without this, fast typing scrambles characters
   *  because parallel execFile invocations race at the OS level. */
  inputQueueTails: Map<string, Promise<void>>;
}

function getStore(): State {
  const g = globalThis as unknown as { __antPtyClient?: State };
  if (!g.__antPtyClient) {
    g.__antPtyClient = {
      outputCbs: new Set(),
      resetCbs: new Set(),
      fileOffsets: new Map(),
      fileInodes: new Map(),
      decoders: new Map(),
      dirWatcher: null,
      watcherBooted: false,
      pollTimer: null,
      inputQueueTails: new Map()
    };
  }
  return g.__antPtyClient;
}

function ensurePtyDirExists(): void {
  if (!existsSync(PTY_DIR)) mkdirSync(PTY_DIR, { recursive: true });
}

/**
 * Decide where to start reading a session's .out file, given what we read
 * last time and the file as it stands now. This is the load-bearing recovery
 * decision for the post-restart / log-rotation case (the "rebind after
 * restart" saga): the pipe-pane sink is normally pure-append, but a restart,
 * truncation, or rotation can replace it with a SHORTER file or a different
 * inode — at which point the old byte offset is stranded ABOVE the new size
 * and `if (size <= offset) return` would silently mute the session forever.
 *
 * Returns the byte offset to read from, plus whether a reset occurred.
 *
 * Policy (Option C, agreed with JWPK): on a genuine reset we resume the LIVE
 * byte stream from the file's CURRENT END (offset = st.size) rather than from
 * 0. Reading from 0 would replay the whole new file through the classifier
 * and duplicate every ANT-view row; resuming from the end keeps the live tail
 * clean, and history is repainted out-of-band by the reset broadcast (the SSE
 * consumer re-captures `capture-pane` scrollback). This mirrors the existing
 * spawn re-attach contract (seed = scrollback, live = from current size).
 *
 * To change the trade-off, this is the only function you need to touch.
 * Exported (underscore-prefixed) for direct unit testing of the decision
 * matrix without standing up a real tmux pipe-pane file.
 */
export function _resolveReadPlan(prevOffset: number, prevIno: number, st: Stats): { from: number; reset: boolean } {
  const rotated = prevIno !== 0 && st.ino !== prevIno; // file replaced under us
  const truncated = st.size < prevOffset;              // file shrank — offset stranded
  if (rotated || truncated) {
    // Reset: adopt the new file's current end as the live baseline. Skip the
    // gap on the live channel; the scrollback re-seed repaints what's onscreen.
    return { from: st.size, reset: true };
  }
  // Normal pure-append: read everything after what we already emitted.
  return { from: prevOffset, reset: false };
}

/**
 * Read any new bytes appended to <sessionId>.out since we last emitted.
 * Updates the per-session offset/inode and fans out to every subscriber.
 * Detects truncation/rotation and broadcasts a reset so consumers repaint.
 */
function drainSessionFile(sessionId: string): void {
  const s = getStore();
  const path = join(PTY_DIR, `${sessionId}.out`);
  if (!existsSync(path)) return;
  let st;
  try { st = statSync(path); } catch { return; }

  const prevOffset = s.fileOffsets.get(sessionId) ?? 0;
  const prevIno = s.fileInodes.get(sessionId) ?? 0;
  const plan = _resolveReadPlan(prevOffset, prevIno, st);

  if (plan.reset) {
    // Drop the UTF-8 decoder: trailing bytes belonged to the old file and
    // must not be stitched onto the new one. Adopt the new offset + inode,
    // then announce the reset so consumers repaint (SSE) / clear stitch
    // buffers (persistence boot) BEFORE any new bytes arrive.
    s.decoders.delete(sessionId);
    s.fileOffsets.set(sessionId, plan.from);
    s.fileInodes.set(sessionId, st.ino);
    for (const cb of s.resetCbs) {
      try { cb(sessionId); } catch { /* swallow — one bad consumer must not block others */ }
    }
    return; // nothing new to emit this tick; the next drain tails from plan.from
  }

  // Keep the inode current even on the no-reset path so a same-size
  // replacement on a LATER tick is still detected.
  s.fileInodes.set(sessionId, st.ino);
  if (st.size <= plan.from) return;

  const fd = openSync(path, 'r');
  try {
    const len = st.size - plan.from;
    const buf = Buffer.allocUnsafe(len);
    readSync(fd, buf, 0, len, plan.from);
    s.fileOffsets.set(sessionId, st.size);
    // StringDecoder holds any trailing incomplete multi-byte sequence so the
    // next drain (which starts exactly at st.size) completes the character.
    let decoder = s.decoders.get(sessionId);
    if (!decoder) { decoder = new StringDecoder('utf8'); s.decoders.set(sessionId, decoder); }
    const data = decoder.write(buf);
    if (data.length === 0) return; // whole chunk was a partial code point — wait for more
    for (const cb of s.outputCbs) {
      try { cb(sessionId, data); } catch { /* swallow */ }
    }
  } finally {
    closeSync(fd);
  }
}

function bootDirWatcher(): void {
  const s = getStore();
  // Lazy-init fields that may be missing after HMR cycles where a cached
  // store predates them (same pattern as inputQueueTails above).
  if (!s.fileOffsets) s.fileOffsets = new Map();
  if (!s.fileInodes) s.fileInodes = new Map();
  if (!s.decoders) s.decoders = new Map();
  if (!s.resetCbs) s.resetCbs = new Set();
  ensurePtyDirExists();

  // Seed offsets for any .out files already on disk so the poll knows
  // about pre-existing tmux sessions (server restart / HMR). Start at the
  // current file size — historical bytes reach the SSE handler via the
  // scrollback capture, so we don't re-emit them through subscribeOutput.
  try {
    for (const entry of readdirSync(PTY_DIR)) {
      if (!entry.endsWith('.out')) continue;
      const sessionId = entry.slice(0, -'.out'.length);
      if (s.fileOffsets.has(sessionId)) continue;
      try {
        const seedSt = statSync(join(PTY_DIR, entry));
        s.fileOffsets.set(sessionId, seedSt.size);
        s.fileInodes.set(sessionId, seedSt.ino);
      } catch { /* skip — file disappeared mid-scan */ }
    }
  } catch { /* PTY_DIR missing — ensurePtyDirExists above covers creation */ }

  if (!s.dirWatcher) {
    s.dirWatcher = fsWatch(PTY_DIR, (_event, filename) => {
      if (!filename || !filename.endsWith('.out')) return;
      const sessionId = filename.slice(0, -'.out'.length);
      drainSessionFile(sessionId);
    });
  }
  // macOS fs.watch silently misses appends to existing files under
  // FSEvents — without polling, live shell output never reaches the SSE
  // subscribers between OS-level write barriers. Poll every 120ms over
  // each known session; drainSessionFile is a no-op when there are no
  // new bytes, so the cost is one stat per active session per tick.
  if (!s.pollTimer) {
    s.pollTimer = setInterval(() => {
      for (const sessionId of s.fileOffsets.keys()) drainSessionFile(sessionId);
    }, 120);
  }
  s.watcherBooted = true;
}

// ─── tmux command helpers ──────────────────────────────────────────────

async function tmux(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFile(TMUX, args, { maxBuffer: 8 * 1024 * 1024 });
}

async function sessionExists(sessionId: string): Promise<boolean> {
  try {
    await tmux(['has-session', '-t', sessionId]);
    return true;
  } catch {
    return false;
  }
}

async function armOutputPipe(sessionId: string, outPath: string): Promise<void> {
  await tmux(['pipe-pane', '-o', '-t', `${sessionId}:0.0`, `cat >> ${shellQuote(outPath)}`]);
}

function seedLiveTailFromCurrentEnd(sessionId: string, outPath: string): void {
  const store = getStore();
  try {
    const st = statSync(outPath);
    store.fileOffsets.set(sessionId, st.size);
    store.fileInodes.set(sessionId, st.ino);
  } catch {
    store.fileOffsets.set(sessionId, 0);
    store.fileInodes.delete(sessionId);
  }
}

// ─── public API ────────────────────────────────────────────────────────

export async function spawnTerminal(
  sessionId: string,
  opts: { cwd?: string; cols?: number; rows?: number } = {}
): Promise<SpawnResult> {
  ensurePtyDirExists();
  bootDirWatcher();

  const cwd = opts.cwd ?? process.env.HOME ?? '/tmp';
  const cols = opts.cols ?? 120;
  const rows = opts.rows ?? 30;
  const outPath = join(PTY_DIR, `${sessionId}.out`);

  try {
    if (await sessionExists(sessionId)) {
      await armOutputPipe(sessionId, outPath);
      seedLiveTailFromCurrentEnd(sessionId, outPath);
      // Re-attach to existing session — capture current scrollback as initial.
      try {
        const { stdout } = await tmux(['capture-pane', '-p', '-t', sessionId]);
        return { alive: true, scrollback: stdout };
      } catch {
        return { alive: true, scrollback: '' };
      }
    }

    // Create a detached session sized to the client viewport, started in cwd.
    await tmux([
      'new-session', '-d',
      '-s', sessionId,
      '-x', String(cols),
      '-y', String(rows),
      '-c', cwd
    ]);

    // Pipe pane output to disk (-o = overwrite previous pipe; we own the
    // file). The shell wrapper guarantees the file is created even before
    // first byte arrives.
    await armOutputPipe(sessionId, outPath);

    // Seed the file-offset baseline at 0 so subsequent appends fan out.
    // Record the inode too so a later rotation (same path, new file) is
    // detected by drainSessionFile even if the size doesn't shrink.
    seedLiveTailFromCurrentEnd(sessionId, outPath);

    return { alive: true, scrollback: '' };
  } catch (cause) {
    // eslint-disable-next-line no-console
    console.error('[ptyClient] spawn failed', sessionId, cause);
    return { alive: false };
  }
}

export function writeInput(sessionId: string, data: string): void {
  // tmux send-keys quirk: `-l` sends bytes literally, which is what we want
  // for text typing — but a literal CR (\r) lands as cursor-to-col-1 rather
  // than a shell-line submission. To submit the line, tmux needs the `Enter`
  // keyname (no -l). Split on CR/LF: text runs go through `-l`, CR/LF go
  // through as `Enter`. Without this, typing "ls" + Enter (xterm sends
  // "ls\r") would leave "ls" sitting on the prompt unexecuted.
  //
  // Serialisation: each writeInput call chains onto the per-session queue
  // tail so all tmux send-keys subprocesses run in arrival order. Fast
  // typing produces a separate POST per keystroke; without serialisation
  // the parallel execFile invocations race at the OS level and the shell
  // sees characters out of order ("hello" → "hlleo").
  const target = `${sessionId}:0.0`;
  const segments: Array<['l', string] | ['k', 'Enter']> = [];
  let segmentStart = 0;
  for (let i = 0; i < data.length; i++) {
    const ch = data.charCodeAt(i);
    if (ch !== 0x0d && ch !== 0x0a) continue;
    if (i > segmentStart) segments.push(['l', data.slice(segmentStart, i)]);
    segments.push(['k', 'Enter']);
    segmentStart = i + 1;
  }
  if (segmentStart < data.length) segments.push(['l', data.slice(segmentStart)]);
  if (segments.length === 0) return;

  const store = getStore();
  // Lazy-init survives HMR cases where a cached store predates this field.
  if (!store.inputQueueTails) store.inputQueueTails = new Map();
  const tails = store.inputQueueTails;
  const prevTail = tails.get(sessionId) ?? Promise.resolve();
  const nextTail = prevTail.then(async () => {
    for (const seg of segments) {
      const args = seg[0] === 'l'
        ? ['send-keys', '-t', target, '-l', seg[1]]
        : ['send-keys', '-t', target, seg[1]];
      try { await execFile(TMUX, args); } catch { /* tmux failures shouldn't break the queue */ }
    }
  });
  // Drop the tail once it settles so the Map doesn't grow unboundedly on
  // long-lived sessions. Compare-and-set keeps later writes' tails intact.
  const cleanupTail = nextTail.finally(() => {
    if (tails.get(sessionId) === cleanupTail) tails.delete(sessionId);
  });
  tails.set(sessionId, cleanupTail);
}

export function resizeTerminal(sessionId: string, cols: number, rows: number): void {
  execFileCb(
    TMUX,
    ['resize-window', '-t', sessionId, '-x', String(cols), '-y', String(rows)],
    () => { /* swallow */ }
  );
}

export function killTerminal(sessionId: string): void {
  execFileCb(TMUX, ['kill-session', '-t', sessionId], () => { /* swallow */ });
}

export async function listTerminals(): Promise<string[]> {
  try {
    const { stdout } = await tmux(['list-sessions', '-F', '#{session_name}']);
    return stdout.trim().length === 0 ? [] : stdout.trim().split('\n');
  } catch {
    // `tmux list-sessions` exits non-zero when no server is running — that's
    // not an error, just an empty list.
    return [];
  }
}

export function subscribeOutput(cb: OutputCb): () => void {
  const s = getStore();
  s.outputCbs.add(cb);
  bootDirWatcher();
  return () => { s.outputCbs.delete(cb); };
}

/**
 * Subscribe to reset events (truncation/rotation/replacement of a session's
 * .out file). Fires with the affected sessionId before any post-reset bytes
 * are emitted, so consumers can repaint (re-seed scrollback) or drop stitch
 * state. Symmetric with subscribeOutput; returns an unsubscribe fn.
 */
export function subscribeReset(cb: ResetCb): () => void {
  const s = getStore();
  if (!s.resetCbs) s.resetCbs = new Set();
  s.resetCbs.add(cb);
  bootDirWatcher();
  return () => { s.resetCbs.delete(cb); };
}

// ─── helpers ───────────────────────────────────────────────────────────

/**
 * Minimal shell-escape for the pipe-pane command. The path is a constant
 * we control (~/.ant/pty/<id>.out) but we still single-quote defensively
 * so a sessionId containing a single-quote can't break out.
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
