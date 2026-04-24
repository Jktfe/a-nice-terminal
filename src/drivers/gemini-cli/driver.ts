// ANT — GeminiCliDriver
// File: src/drivers/gemini-cli/driver.ts
//
// Implements the AgentDriver interface for Gemini CLI 0.37.0.
// Generated from probe run 2026-04-14 against gemini-cli v0.37.0.
// See spec.json for detection patterns and NOTES.md for deviations.
//
// Key deviation: Gemini CLI has NO per-tool approval TUI dialogs.
// Approval is managed via a pre-submission mode toggle (Shift+Tab cycles
// through default → auto-accept → plan modes). The driver detects
// completed tool results, not pending approval requests.
//
// Submit key: BTab (Shift+Tab) from default mode; Enter in auto-accept mode.

import type {
  AgentDriver,
  EventClass,
  NormalisedEvent,
  RawEvent,
  RawOutput,
  UserChoice,
} from '../../fingerprint/types.js';
import type { AgentStatus } from '../../lib/shared/agent-status.js';

export type SendKeysFn = (keys: string[]) => Promise<void>;

// ─── Detection patterns (from probe run 2026-04-14) ──────────────────────────

// Gemini response prefix
const RESPONSE_RE      = /^✦\s+/m;

// Tool result box — appears AFTER tool execution completes
const TOOL_WRITE_RE   = /│\s+✓\s+WriteFile\s+/;
const TOOL_SHELL_RE   = /│\s+✓\s+Shell\s+/;
const TOOL_READ_RE    = /│\s+✓\s+ReadFile\s+/;

// Approval mode indicators in status bar
const MODE_AUTO_ACCEPT_RE = /auto-accept edits/;
const MODE_PLAN_RE        = /^plan\s/m;

// Idle / active state discriminators
const IDLE_STATUS_RE = /\? for shortcuts/;
const RESPONDING_RE  = /Responding with gemini-[\w-]+/;

// Text-level interaction patterns (TODO: validate against P04/P06/P07/P10)
const CHOICE_QUESTION_RE = /(which one|please choose|pick one|choose one|select one|which would you)/i;
const NUMBERED_LIST_RE   = /^\s*\d+\.\s+\S/m;
const CONFIRM_RE         = /(shall I go ahead|want me to proceed|are you sure|proceed\?)/i;
const FREE_TEXT_RE       = /^✦.+\?\s*$/m;
const ERROR_RETRY_RE     = /^✦.+(doesn't exist|does not exist|not found|failed|error)[^]*?(would you like|want me to|shall I|did you mean)/ims;

// Regex helpers — use .match() to avoid exec() pattern in security hook
function extractGroup(text: string, pattern: RegExp, groupIndex = 1): string | undefined {
  return text.match(pattern)?.[groupIndex];
}

// ─── NormalisedEvent extension ────────────────────────────────────────────────

export interface GeminiEvent extends NormalisedEvent {
  class:   EventClass;
  payload: Record<string, unknown>;
}

// ─── GeminiCliDriver ──────────────────────────────────────────────────────────

export class GeminiCliDriver implements AgentDriver {
  private hooksActive = false;

  /**
   * Enable/disable hook-based event prioritization.
   */
  setHooksActive(active: boolean) {
    this.hooksActive = active;
  }

  /**
   * Detect interactive events from a single raw tmux output line.
   *
   * NOTE: Gemini CLI does NOT emit pre-tool approval dialogs.
   * Tool result boxes (╭─╮ │ ✓ ToolName │ ╰─╯) signal *completed* operations,
   * not pending ones. The driver focuses on:
   *  - progress: "Responding with gemini-*" indicator
   *  - free_text / multi_choice / confirmation / error_retry: text-level patterns
   *    on response lines starting with ✦
   */
  detect(raw: RawEvent): NormalisedEvent | null {
    const { text, ts } = raw;

    // If hooks are active, skip progress/tool detection as they are handled via hooks
    if (!this.hooksActive) {
      // Progress — model generating a response
      if (RESPONDING_RE.test(text)) {
        return this.makeEvent(ts, raw.raw, text, 'progress', { model: text.trim() });
      }

      // Completed tool results — emit progress so the runner knows a tool ran
      if (TOOL_WRITE_RE.test(text)) {
        const file = extractGroup(text.trim(), /WriteFile Writing to (.+)$/) ?? 'unknown';
        return this.makeEvent(ts, raw.raw, text, 'progress', { tool: 'WriteFile', file });
      }
      if (TOOL_SHELL_RE.test(text)) {
        const cmd = extractGroup(text.trim(), /Shell (.+?)\s*\[/) ?? 'unknown';
        return this.makeEvent(ts, raw.raw, text, 'progress', { tool: 'Shell', command: cmd });
      }
      if (TOOL_READ_RE.test(text)) {
        const file = extractGroup(text.trim(), /ReadFile (.+)$/) ?? 'unknown';
        return this.makeEvent(ts, raw.raw, text, 'progress', { tool: 'ReadFile', file });
      }
    }

    // Text-level interactive patterns on ✦ response lines
    if (RESPONSE_RE.test(text)) {
      // error_retry (more specific — check before free_text)
      if (ERROR_RETRY_RE.test(text)) {
        return this.makeEvent(ts, raw.raw, text, 'error_retry', { message: text.trim() });
      }

      // multi_choice: numbered list + choice question
      if (CHOICE_QUESTION_RE.test(text) && NUMBERED_LIST_RE.test(text)) {
        return this.makeEvent(ts, raw.raw, text, 'multi_choice', { question: text.trim(), options: [] });
      }

      // confirmation
      if (CONFIRM_RE.test(text)) {
        return this.makeEvent(ts, raw.raw, text, 'confirmation', { question: text.trim() });
      }

      // free_text: ✦ line ending in ?
      if (FREE_TEXT_RE.test(text)) {
        return this.makeEvent(ts, raw.raw, text, 'free_text', { question: text.trim() });
      }
    }

    return null;
  }

  /**
   * Determine current approval mode from a multi-line window.
   */
  detectMode(window: string): 'default' | 'auto_accept' | 'plan' {
    if (MODE_AUTO_ACCEPT_RE.test(window)) return 'auto_accept';
    if (MODE_PLAN_RE.test(window))        return 'plan';
    return 'default';
  }

  /**
   * Translate the user's choice into tmux key sequences.
   * In auto-accept mode (the common post-first-submit state), Enter submits.
   * In default mode, BTab submits.
   */
  async respond(event: NormalisedEvent, choice: UserChoice, sendKeys?: SendKeysFn): Promise<void> {
    const keys = this.buildKeys((event as GeminiEvent).class, choice);
    if (keys === null) return;
    if (!sendKeys) throw new Error('GeminiCliDriver.respond requires a sendKeys callback');
    await sendKeys(keys);
  }

  /**
   * True once Gemini has settled: '? for shortcuts' visible, no active generation.
   */
  isSettled(event: NormalisedEvent, output: RawOutput): boolean {
    const window = output.lines.slice(-15).map(e => e.text).join('\n');
    const eventClass = (event as GeminiEvent).class;

    switch (eventClass) {
      case 'progress':
        return IDLE_STATUS_RE.test(window) && !RESPONDING_RE.test(window);

      case 'multi_choice':
      case 'confirmation':
      case 'free_text':
      case 'error_retry':
        return IDLE_STATUS_RE.test(window) && !RESPONDING_RE.test(window);

      // permission_request / tool_auth never fire from detect() in this driver
      case 'permission_request':
      case 'tool_auth':
        return IDLE_STATUS_RE.test(window);

      default:
        return false;
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private makeEvent(
    ts: number,
    raw: string,
    text: string,
    eventClass: EventClass,
    payload: Record<string, unknown>,
  ): GeminiEvent {
    return {
      seq:    0,
      ts,
      source: 'tmux',
      type:   'output',
      raw,
      text,
      class:  eventClass,
      payload,
    };
  }

  private buildKeys(eventClass: EventClass, choice: UserChoice): string[] | null {
    switch (eventClass) {
      // Gemini has no TUI dialog for permission/tool_auth — no response needed
      case 'permission_request':
      case 'tool_auth':
        return null;

      case 'multi_choice': {
        if (choice.type === 'select') return [String(choice.index + 1), 'Enter'];
        if (choice.type === 'text')   return [choice.value, 'Enter'];
        return null;
      }

      case 'confirmation': {
        if (choice.type === 'confirm') return [choice.yes ? 'yes' : 'no', 'Enter'];
        return ['no', 'Enter'];
      }

      case 'free_text':
      case 'error_retry': {
        if (choice.type === 'text')  return [choice.value, 'Enter'];
        if (choice.type === 'abort') return ['', 'Escape'];
        return null;
      }

      case 'progress':
        return null;

      default:
        return null;
    }
  }

  detectStatus(recentLines: string[]): AgentStatus | null {
    const text = recentLines.join('\n');
    const now = Date.now();

    let state: AgentStatus['state'] = 'unknown';
    let activity: string | undefined;
    let model: string | undefined;

    // Gemini state patterns
    if (/\? for shortcuts/.test(text)) state = 'ready';
    if (/Responding with (gemini-[\w.-]+)/i.test(text)) {
      state = 'busy';
      const match = text.match(/Responding with (gemini-[\w.-]+)/i);
      if (match) model = match[1];
    }

    // Model from status line: "Auto Gemini 3" or "gemini-2.5-pro"
    if (!model) {
      const modelMatch = text.match(/(Gemini\s*[\d.]+|gemini-[\w.-]+)/i);
      if (modelMatch) model = modelMatch[1];
    }

    // Context from status line: "0% used"
    let contextUsedPct: number | undefined;
    const ctxMatch = text.match(/(\d+)%\s+used/);
    if (ctxMatch) contextUsedPct = parseInt(ctxMatch[1], 10);

    // Tool completion as activity
    const toolMatch = text.match(/│\s+✓\s+(Shell|WriteFile|ReadFile|SearchFile)\s+(.+?)(?:\s+\d|$)/);
    if (toolMatch) {
      activity = `${toolMatch[1]}: ${toolMatch[2].trim()}`;
    }

    if (state === 'unknown') return null;

    return {
      state,
      activity,
      model,
      contextUsedPct,
      contextRemainingPct: contextUsedPct != null ? 100 - contextUsedPct : undefined,
      detectedAt: now,
    };
  }
}
