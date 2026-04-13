// ANT — OllamaDriver
// File: src/drivers/ollama/driver.ts
//
// Implements the AgentDriver interface for Ollama (interactive REPL).
// Tested: ollama CLI with gemma4:26b, glm-ocr, deepseek-v3.1
// Probe date: 2026-04-14
//
// Ollama is a pure completion tool with a readline REPL.
// There are NO permission TUIs, tool authorisation dialogs, or structured
// interactive events. detect() returns null for all lines except progress.
//
// Interactive mode:   ollama run <model>   → ">>> " readline prompt
// Non-interactive:    echo "prompt" | ollama run <model>   → streams response + exits
// API mode:           ollama serve  (HTTP on :11434)

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

// Idle REPL prompt (interactive mode)
const REPL_PROMPT_RE   = /^>>>\s*(Send a message)?/m;

// Loading / thinking spinner (braille unicode + ANSI cursor sequences)
// Raw: [?2026h[?25l[1G⠙ [K[?25h[?2026l
const SPINNER_ANSI_RE  = /[⠙⠹⠸⠼⠴⠦⠧⠇⠏⠋]/;
const THINKING_RE      = /Thinking\.\.\./;

// Streaming token output: during generation, tokens stream with cursor sequences
// Settled state: back to >>> prompt with no spinner
const STREAM_ANSI_RE   = /\[\?25[lh]/;   // cursor hide/show = active generation

// ─── NormalisedEvent extension ────────────────────────────────────────────────

export interface OllamaEvent extends NormalisedEvent {
  class:   EventClass;
  payload: Record<string, unknown>;
}

// ─── OllamaDriver ─────────────────────────────────────────────────────────────

export class OllamaDriver implements AgentDriver {

  /**
   * Ollama has no interactive events — detect() only returns progress
   * during model loading/thinking and null otherwise.
   *
   * All event classes from the ANT spec (permission_request, multi_choice,
   * confirmation, free_text, tool_auth, error_retry) are NOT APPLICABLE to
   * Ollama. It is a pure completion REPL.
   */
  detect(raw: RawEvent): NormalisedEvent | null {
    const { text, ts } = raw;

    // Loading spinner (braille chars in raw output before model responds)
    if (SPINNER_ANSI_RE.test(raw.raw) || THINKING_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', { phase: 'thinking' });
    }

    // Active token streaming (ANSI cursor sequences in raw output)
    if (STREAM_ANSI_RE.test(raw.raw) && !REPL_PROMPT_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', { phase: 'streaming' });
    }

    return null;
  }

  async respond(_event: NormalisedEvent, _choice: UserChoice, sendKeys?: SendKeysFn): Promise<void> {
    // Ollama only produces progress events — no interactive responses needed.
    // For interactive REPL use, the caller sends the prompt via sendKeys directly.
    void sendKeys;
  }

  isSettled(event: NormalisedEvent, output: RawOutput): boolean {
    const window = output.lines.slice(-5).map(e => e.text).join('\n');
    // Settled = ">>> " prompt visible and no spinner in raw recent output
    const rawWindow = output.lines.slice(-5).map(e => e.raw).join('');
    return (
      REPL_PROMPT_RE.test(window) &&
      !SPINNER_ANSI_RE.test(rawWindow) &&
      !THINKING_RE.test(window)
    );
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private makeEvent(
    ts: number, raw: string, text: string,
    eventClass: EventClass, payload: Record<string, unknown>,
  ): OllamaEvent {
    return { seq: 0, ts, source: 'tmux', type: 'output', raw, text, class: eventClass, payload };
  }
}
