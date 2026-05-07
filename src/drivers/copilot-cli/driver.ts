// ANT — CopilotCliDriver
// File: src/drivers/copilot-cli/driver.ts
//
// Implements the AgentDriver interface for GitHub Copilot CLI v1.0.36.
// Based on live terminal capture from Slot 3 audit 2026-04-27.
//
// Copilot CLI (--allow-all mode) auto-executes shell commands and file edits.
// The TUI uses ❯ for user prompts, ● for status/tool results, ◐ for thinking.
// Status bar: " / commands · ? help" + model name on the right.
//
// Design: respond() accepts a sendKeys callback (same pattern as other drivers).

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

// ─── Detection patterns (from Slot 3 probe 2026-04-27) ──────────────────────

// User prompt line
const PROMPT_RE = /^❯\s*/m;

// Tool/status bullet prefix
const BULLET_RE = /^●\s+/m;

// Thinking indicator
const THINKING_RE = /^◐\s+/m;

// Tool call patterns
const TOOL_SHELL_RE = /^●\s+.+\(shell\)/m;
const TOOL_READ_RE = /^●\s+Read\s+/m;
const TOOL_EDIT_RE = /^●\s+Edit\s+/m;
const TOOL_WRITE_RE = /^●\s+Write\s+/m;

// Success indicator
const SUCCESS_RE = /✅/;

// Model from status bar: right-aligned, e.g. "Claude Sonnet 4.6", "GPT-5.4"
const MODEL_RE = /(?:Claude\s+(?:Sonnet|Opus|Haiku)\s+[\d.]+|GPT-[\d.]+(?:-\w+)*|Gemini\s+[\d.]+\s*\w*)/i;

// Chrome patterns (UI elements, not content)
const CHROME_PATTERNS = [
  /^─{10,}$/,                    // horizontal rules
  /^❯\s*$/,                      // empty prompt
  /^\s*\/\s*commands\s*·/,       // status bar
  /^\s*\?\s*help\b/,             // help hint
  /^\s*\/ commands · \? help/,   // full status line
  /^╭─|^╰─|^│\s/,               // box drawing for tool output
  /^●\s+Environment loaded/,     // startup banner
  /^!\s+Failed to connect/,      // MCP connection warnings
  /^●\s+💡\s+No copilot/,       // copilot-instructions hint
  /^●\s+Describe a task/,        // startup prompt hint
  /^Tip:/,                       // tips
];

// Interactive patterns
const CONFIRM_RE = /(shall I|want me to|proceed\?|are you sure|do you want|would you like)/i;
const CHOICE_QUESTION_RE = /(which one|please choose|pick one|choose one|select one|which would you)/i;
const NUMBERED_LIST_RE = /^\s*\d+\.\s+\S/m;
const FREE_TEXT_RE = /\?\s*$/m;
const ERROR_RETRY_RE = /(error|failed|not found|doesn't exist)[^]*?(would you like|want me to|shall I|try again)/ims;

// ─── NormalisedEvent extension ────────────────────────────────────────────────

export interface CopilotEvent extends NormalisedEvent {
  class: EventClass;
  payload: Record<string, unknown>;
}

// ─── CopilotCliDriver ─────────────────────────────────────────────────────────

export class CopilotCliDriver implements AgentDriver {
  private hooksActive = false;

  setHooksActive(active: boolean): void {
    this.hooksActive = active;
  }

  detect(raw: RawEvent): NormalisedEvent | null {
    const { text, ts } = raw;

    // Thinking — model is generating
    if (THINKING_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', {
        activity: text.replace(/^◐\s+/, '').trim(),
      });
    }

    // Tool execution results
    if (TOOL_SHELL_RE.test(text)) {
      const cmd = text.match(/●\s+(.+)\(shell\)/)?.[1]?.trim() ?? 'unknown';
      return this.makeEvent(ts, raw.raw, text, 'progress', { tool: 'Shell', command: cmd });
    }
    if (TOOL_READ_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', { tool: 'Read' });
    }
    if (TOOL_EDIT_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', { tool: 'Edit' });
    }
    if (TOOL_WRITE_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', { tool: 'Write' });
    }
    if (SUCCESS_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', { signal: 'success' });
    }

    // Interactive patterns on bullet lines
    if (BULLET_RE.test(text) || PROMPT_RE.test(text)) {
      if (ERROR_RETRY_RE.test(text)) {
        return this.makeEvent(ts, raw.raw, text, 'error_retry', { message: text.trim() });
      }
      if (CHOICE_QUESTION_RE.test(text) && NUMBERED_LIST_RE.test(text)) {
        return this.makeEvent(ts, raw.raw, text, 'multi_choice', { question: text.trim(), options: [] });
      }
      if (CONFIRM_RE.test(text)) {
        return this.makeEvent(ts, raw.raw, text, 'confirmation', { question: text.trim() });
      }
      if (FREE_TEXT_RE.test(text) && text.length > 10) {
        return this.makeEvent(ts, raw.raw, text, 'free_text', { question: text.trim() });
      }
    }

    return null;
  }

  async respond(event: NormalisedEvent, choice: UserChoice, sendKeys?: SendKeysFn): Promise<void> {
    const keys = this.buildKeys((event as CopilotEvent).class, choice);
    if (keys === null) return;
    if (!sendKeys) throw new Error('CopilotCliDriver.respond requires a sendKeys callback');
    await sendKeys(keys);
  }

  isSettled(event: NormalisedEvent, output: RawOutput): boolean {
    const window = output.lines.slice(-10).map(e => e.text).join('\n');
    const eventClass = (event as CopilotEvent).class;

    switch (eventClass) {
      case 'progress':
        return PROMPT_RE.test(window) && !THINKING_RE.test(window);

      case 'multi_choice':
      case 'confirmation':
      case 'free_text':
      case 'error_retry':
        return PROMPT_RE.test(window) && !THINKING_RE.test(window);

      case 'permission_request':
      case 'tool_auth':
        return true; // --allow-all mode, never fires

      default:
        return false;
    }
  }

  isChrome(line: string): boolean {
    return CHROME_PATTERNS.some(re => re.test(line));
  }

  detectStatus(recentLines: string[]): AgentStatus | null {
    const text = recentLines.join('\n');
    const now = Date.now();

    let state: AgentStatus['state'] = 'unknown';
    let activity: string | undefined;
    let model: string | undefined;
    let workspace: string | undefined;
    let branch: string | undefined;

    // Detect model from status bar
    const modelMatch = text.match(MODEL_RE);
    if (modelMatch) model = modelMatch[0].trim();

    // Detect state
    if (THINKING_RE.test(text)) {
      state = 'busy';
      const thinkingLine = recentLines.find(l => THINKING_RE.test(l));
      if (thinkingLine) activity = thinkingLine.replace(/^◐\s+/, '').trim();
    } else if (PROMPT_RE.test(text)) {
      state = 'ready';
    }

    // Workspace from path line: ~/CascadeProjects/a-nice-terminal [⎇ main*%]
    const wsMatch = text.match(/^\s*(~\/\S+)\s+\[⎇\s+([^\]\s]+)/m);
    if (wsMatch) {
      workspace = wsMatch[1];
      branch = wsMatch[2].replace(/[*%]+$/, '');
    }

    if (state === 'unknown' && !model) return null;
    if (state === 'unknown') state = 'ready';

    return {
      state,
      activity,
      model,
      workspace,
      branch,
      detectedAt: now,
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private makeEvent(
    ts: number,
    raw: string,
    text: string,
    eventClass: EventClass,
    payload: Record<string, unknown>,
  ): CopilotEvent {
    return {
      seq: 0,
      ts,
      source: 'tmux',
      type: 'output',
      raw,
      text,
      class: eventClass,
      payload,
    };
  }

  private buildKeys(eventClass: EventClass, choice: UserChoice): string[] | null {
    switch (eventClass) {
      case 'permission_request':
      case 'tool_auth':
        return null; // --allow-all mode

      case 'multi_choice': {
        if (choice.type === 'select') return [String(choice.index + 1), 'Enter'];
        if (choice.type === 'text') return [choice.value, 'Enter'];
        return null;
      }

      case 'confirmation': {
        if (choice.type === 'confirm') return [choice.yes ? 'yes' : 'no', 'Enter'];
        return ['no', 'Enter'];
      }

      case 'free_text':
      case 'error_retry': {
        if (choice.type === 'text') return [choice.value, 'Enter'];
        if (choice.type === 'abort') return ['', 'Escape'];
        return null;
      }

      case 'progress':
        return null;

      default:
        return null;
    }
  }
}
