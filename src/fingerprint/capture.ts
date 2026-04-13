// ANT Fingerprinting Pipeline — tmux control-mode capture daemon
// File: src/fingerprint/capture.ts
//
// Attaches to a tmux session via control mode (`tmux -C attach -t <session>`)
// and emits NormalisedEvent objects with a 100ms debounce so that rapid
// token-by-token agent output is coalesced into single events.
//
// Safety: tmux session names are validated against SAFE_SESSION_RE before use.
// Arguments are passed as an array to spawn() — no shell interpolation occurs.

import { execFile, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import stripAnsi from 'strip-ansi';
import type { NormalisedEvent } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 100;

// Only allow alphanumeric, hyphen, underscore, and dot in session names.
const SAFE_SESSION_RE = /^[A-Za-z0-9_.\-]{1,64}$/;

// Shell prompt patterns — detect when the agent has finished and the shell is ready.
const PROMPT_RE = /(\$\s*$|%\s*$|>\s*$|❯\s*$|➜\s*$)/m;

// tmux control-mode line prefixes we care about
const TMUX_OUTPUT_RE   = /^%output\s+(%\d+)\s(.*)$/s;
const TMUX_SESSION_RE  = /^%session-renamed\s+(\S+)\s+(.+)$/;
const TMUX_PANE_RE     = /^%pane-focus-in\s+(%\d+)$/;
const TMUX_EXIT_RE     = /^%exit/;

// ─── CaptureSession ───────────────────────────────────────────────────────────

export interface CaptureSessionOptions {
  tmuxSession: string;
  seq_start?: number;
  prompt_pattern?: RegExp;
}

/**
 * CaptureSession attaches to a tmux session in control mode and emits
 * NormalisedEvent objects. Use `.start()` to attach, `.dispose()` to detach.
 *
 * Events emitted:
 *   'event'  — (e: NormalisedEvent) — debounced normalised output
 *   'prompt' — () — shell prompt detected (agent idle)
 *   'error'  — (err: Error) — capture process error
 *   'exit'   — () — tmux session ended
 */
export class CaptureSession extends EventEmitter {
  private proc: ChildProcess | null = null;
  private seq = 0;
  private probeStart = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: string[] = [];
  private pendingPaneId: string | undefined;
  private pendingLastRaw: string | undefined;
  private promptRe: RegExp;

  constructor(private opts: CaptureSessionOptions) {
    super();
    if (!SAFE_SESSION_RE.test(opts.tmuxSession)) {
      throw new Error(
        `Invalid tmux session name "${opts.tmuxSession}". ` +
        'Must be alphanumeric with hyphens, underscores, or dots (max 64 chars).'
      );
    }
    this.seq = opts.seq_start ?? 0;
    this.promptRe = opts.prompt_pattern ?? PROMPT_RE;
  }

  /** Attach to the tmux session. Resolves once control mode is ready. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.probeStart = Date.now();

      // Args passed as array — no shell involved, no injection possible.
      // -C = control mode  -r = read-only (prevents accidental key injection into panes)
      this.proc = execFile(
        'tmux',
        ['-C', 'attach', '-t', this.opts.tmuxSession, '-r'],
        { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
        (err) => {
          if (err && (err as NodeJS.ErrnoException).code !== 'SIGTERM') {
            this.emit('exit');
          }
        }
      );

      let ready = false;

      this.proc.stdout?.on('data', (chunk: string) => {
        if (!ready) { ready = true; resolve(); }
        this.handleChunk(chunk);
      });

      this.proc.stderr?.on('data', (chunk: string) => {
        if (!ready) {
          ready = true;
          reject(new Error(`tmux attach failed: ${chunk.trim()}`));
        }
      });

      this.proc.on('exit', () => this.emit('exit'));

      // Timeout if tmux doesn't respond within 5 seconds
      setTimeout(() => {
        if (!ready) reject(new Error(`tmux attach timed out for session "${this.opts.tmuxSession}"`));
      }, 5000);
    });
  }

  /** Mark the start of a new probe (resets timestamp origin). */
  resetClock(): void {
    this.probeStart = Date.now();
  }

  /** Detach from the tmux session and clean up. */
  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.proc?.kill('SIGTERM');
    this.proc = null;
    this.removeAllListeners();
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private handleChunk(chunk: string): void {
    for (const line of chunk.split('\n')) {
      this.parseLine(line.trimEnd());
    }
  }

  private parseLine(line: string): void {
    if (!line || line === '%begin' || line === '%end') return;

    if (TMUX_EXIT_RE.test(line)) { this.emit('exit'); return; }

    const paneMatch = TMUX_PANE_RE.exec(line);
    if (paneMatch) {
      this.emitEvent({ type: 'pane_changed', raw: line, text: '', pane_id: paneMatch[1] });
      return;
    }

    const sessionMatch = TMUX_SESSION_RE.exec(line);
    if (sessionMatch) {
      this.emitEvent({ type: 'session_renamed', raw: line, text: sessionMatch[2] });
      return;
    }

    const outputMatch = TMUX_OUTPUT_RE.exec(line);
    if (outputMatch) {
      const [, pane_id, raw] = outputMatch;
      this.pending.push(normalise(raw));
      this.pendingPaneId = pane_id;
      this.pendingLastRaw = raw;
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flushDebounce(), DEBOUNCE_MS);
  }

  private flushDebounce(): void {
    if (this.pending.length === 0) return;

    const coalesced = this.pending.join('');
    const pane_id   = this.pendingPaneId;
    const lastRaw   = this.pendingLastRaw ?? coalesced;
    this.pending        = [];
    this.pendingPaneId  = undefined;
    this.pendingLastRaw = undefined;
    this.debounceTimer  = null;

    this.emitEvent({ type: 'output', raw: lastRaw, text: coalesced, pane_id });

    if (this.promptRe.test(coalesced)) this.emit('prompt');
  }

  private emitEvent(partial: Omit<NormalisedEvent, 'seq' | 'ts' | 'source'>): void {
    const event: NormalisedEvent = {
      seq:    this.seq++,
      ts:     Date.now() - this.probeStart,
      source: 'tmux',
      ...partial,
    };
    this.emit('event', event);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalise(raw: string): string {
  return stripAnsi(raw)
    .replace(/\r/g, '')
    .replace(/\x00/g, '')
    .replace(/[ \t]+$/gm, '');
}
