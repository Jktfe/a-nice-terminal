// ANT — LmStudioDriver
// File: src/drivers/lm-studio/driver.ts
//
// Implements the AgentDriver interface for LM Studio CLI (lms).
// Tested: lms v? with openai/gpt-oss-20b (20B, local)
// Probe date: 2026-04-14
//
// LM Studio CLI is a pure completion tool. No permission TUIs exist.
// The `lms chat` command has two modes:
//   - Interactive:     lms chat <model>               → readline REPL
//   - Non-interactive: lms chat <model> --prompt "..."  → streams response + exits
//
// detect() returns null for all lines except progress indicators.

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

// LM Studio interactive chat prompt (TODO: validate exact string)
const CHAT_PROMPT_RE = /^You:\s*$/m;

// LM Studio response prefix (TODO: validate exact string)
const RESPONSE_PREFIX_RE = /^AI:\s*/m;

// Streaming: LM Studio may emit [?25l/h ANSI for cursor during streaming
const STREAM_ACTIVE_RE = /\[\?25[lh]/;

// Think/reasoning block (some models show <think>...</think>)
const THINKING_RE = /<think>|<\/think>/;

// ─── NormalisedEvent extension ────────────────────────────────────────────────

export interface LmStudioEvent extends NormalisedEvent {
  class:   EventClass;
  payload: Record<string, unknown>;
}

// ─── LmStudioDriver ───────────────────────────────────────────────────────────

export class LmStudioDriver implements AgentDriver {

  /**
   * LM Studio CLI has no interactive events.
   * detect() only returns progress during streaming; null otherwise.
   * All ANT permission/choice/confirmation classes are NOT APPLICABLE.
   */
  detect(raw: RawEvent): NormalisedEvent | null {
    const { text, ts } = raw;

    // Thinking block (reasoning models)
    if (THINKING_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', { phase: 'thinking' });
    }

    // Active streaming (ANSI cursor hide/show in raw output)
    if (STREAM_ACTIVE_RE.test(raw.raw) && !CHAT_PROMPT_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', { phase: 'streaming' });
    }

    return null;
  }

  async respond(_event: NormalisedEvent, _choice: UserChoice, _sendKeys?: SendKeysFn): Promise<void> {
    // No interactive events — nothing to respond to.
  }

  isSettled(_event: NormalisedEvent, output: RawOutput): boolean {
    const rawWindow = output.lines.slice(-5).map(e => e.raw).join('');
    const textWindow = output.lines.slice(-5).map(e => e.text).join('\n');
    // Settled = chat prompt visible (interactive) or no streaming ANSI (non-interactive)
    return CHAT_PROMPT_RE.test(textWindow) || !STREAM_ACTIVE_RE.test(rawWindow);
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private makeEvent(
    ts: number, raw: string, text: string,
    eventClass: EventClass, payload: Record<string, unknown>,
  ): LmStudioEvent {
    return { seq: 0, ts, source: 'tmux', type: 'output', raw, text, class: eventClass, payload };
  }
}
