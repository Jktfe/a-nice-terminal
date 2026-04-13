// ANT — LlmDriver
// File: src/drivers/llm/driver.ts
//
// Implements the AgentDriver interface for Simon Willison's `llm` CLI tool.
// Installed at: ~/.local/bin/llm
// Probe date: 2026-04-14
//
// `llm` is a pure completion CLI tool — it accepts a prompt and streams
// a response to stdout, then exits. There is NO interactive REPL or TUI.
// There are NO permission prompts, tool calls, or structured dialogs.
//
// Usage:
//   llm 'prompt'                  → completion to stdout
//   llm 'prompt' -m <model>       → use specific model
//   cat file | llm 'instruction'  → piped input
//   llm chat                      → multi-turn readline chat
//
// detect() ALWAYS returns null. This driver is a minimal stub.

import type {
  AgentDriver,
  NormalisedEvent,
  RawEvent,
  RawOutput,
  UserChoice,
} from '../../fingerprint/types.js';

export type SendKeysFn = (keys: string[]) => Promise<void>;

// ─── LlmDriver ────────────────────────────────────────────────────────────────

export class LlmDriver implements AgentDriver {

  /**
   * `llm` produces no interactive events.
   * Always returns null — the tool streams its completion to stdout and exits.
   */
  detect(_raw: RawEvent): NormalisedEvent | null {
    return null;
  }

  async respond(_event: NormalisedEvent, _choice: UserChoice, _sendKeys?: SendKeysFn): Promise<void> {
    // No interactive events — nothing to respond to.
  }

  isSettled(_event: NormalisedEvent, _output: RawOutput): boolean {
    // `llm` exits on completion — process exit = settled.
    return true;
  }
}
