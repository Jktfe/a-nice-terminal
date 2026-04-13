// ANT — LlamafileDriver
// File: src/drivers/llamafile/driver.ts
//
// Implements the AgentDriver interface for Mozilla llamafile.
// Tested: granite-vision-3.3-2b.llamafile v0.9.3 (self-contained binary)
// Installed at: ~/llamafiles/
// Probe date: 2026-04-14
//
// llamafile is a self-contained executable that bundles a model + llama.cpp.
// There are NO permission TUIs or interactive events.
//
// Modes:
//   --cli   -p "prompt"   → single-shot completion to stdout, then exits
//   --chat                → readline REPL (similar to Ollama's >>> prompt)
//   --server              → HTTP server (llama.cpp compat API on :8080)
//
// The model GGUF is embedded in the .llamafile binary — no -m flag needed.
// detect() returns null for --cli mode (pure completion).
// detect() returns progress for --chat mode (streaming).

import type {
  AgentDriver,
  EventClass,
  NormalisedEvent,
  RawEvent,
  RawOutput,
  UserChoice,
} from '../../fingerprint/types.js';

export type SendKeysFn = (keys: string[]) => Promise<void>;

// ─── Detection patterns ───────────────────────────────────────────────────────

// llamafile --chat readline prompt (TODO: validate exact string)
const CHAT_PROMPT_RE = /^>\s*$/m;

// llamafile loading / init output (llama.cpp logs to stderr)
const LOADING_RE = /^llama_|^ggml_|^load_|^build:/m;

// ANSI streaming activity
const STREAM_ACTIVE_RE = /\[\?25[lh]/;

// ─── NormalisedEvent extension ────────────────────────────────────────────────

export interface LlamafileEvent extends NormalisedEvent {
  class:   EventClass;
  payload: Record<string, unknown>;
}

// ─── LlamafileDriver ──────────────────────────────────────────────────────────

export class LlamafileDriver implements AgentDriver {

  /**
   * llamafile has no interactive events in --cli mode.
   * In --chat mode, only progress (streaming) events are emitted.
   * All ANT permission/choice/confirmation classes are NOT APPLICABLE.
   */
  detect(raw: RawEvent): NormalisedEvent | null {
    const { text, ts } = raw;

    // llama.cpp loading output (stderr redirected to stdout)
    if (LOADING_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', { phase: 'loading' });
    }

    // Active streaming in --chat mode
    if (STREAM_ACTIVE_RE.test(raw.raw) && !CHAT_PROMPT_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', { phase: 'streaming' });
    }

    return null;
  }

  async respond(_event: NormalisedEvent, _choice: UserChoice, _sendKeys?: SendKeysFn): Promise<void> {
    // No interactive events.
  }

  isSettled(_event: NormalisedEvent, output: RawOutput): boolean {
    const textWindow = output.lines.slice(-5).map(e => e.text).join('\n');
    const rawWindow  = output.lines.slice(-5).map(e => e.raw).join('');
    // --cli: process exits (always settled)
    // --chat: settled when chat prompt visible
    return CHAT_PROMPT_RE.test(textWindow) || !STREAM_ACTIVE_RE.test(rawWindow);
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private makeEvent(
    ts: number, raw: string, text: string,
    eventClass: EventClass, payload: Record<string, unknown>,
  ): LlamafileEvent {
    return { seq: 0, ts, source: 'tmux', type: 'output', raw, text, class: eventClass, payload };
  }
}
