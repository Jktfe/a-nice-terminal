// ANT — ClaudeCodeDriver
// File: src/drivers/claude-code/driver.ts
//
// Implements the AgentDriver interface for Claude Code 2.1.89.
// Generated from probe run 2026-04-13 against claude v2.1.89.
// See spec.json for full detection patterns and NOTES.md for deviations.
//
// Design: respond() accepts a sendKeys callback so the driver itself
// contains no subprocess calls — the caller injects tmux send-keys.

import type {
  AgentDriver,
  EventClass,
  NormalisedEvent,
  RawEvent,
  RawOutput,
  UserChoice,
} from '../../fingerprint/types.js';
import { readMergedAgentState } from '../../fingerprint/agent-state-reader.js';
import {
  legacyStateFromLabel,
  type AgentStateLabel,
  type AgentStatus,
} from '../../lib/shared/agent-status.js';

// ─── Callback type injected by caller ────────────────────────────────────────

export type SendKeysFn = (keys: string[]) => Promise<void>;

// ─── Detection patterns (from probe run 2026-04-13) ──────────────────────────

// Wide horizontal divider that precedes all TUI permission dialogs
const DIVIDER_RE = /─{10,}/;

// TUI headers (follow the divider)
const HEADER_WRITE_RE   = /^\s*(Create file|Edit file|Delete file)\s*$/m;
const HEADER_EXECUTE_RE = /^\s*Bash command\s*$/m;
const HEADER_TOOL_RE    = /^\s*Tool use\s*$/m;

// Option 1 marker — present in all TUI types while waiting for input
const OPTION_YES_RE = /❯\s+1\.\s+Yes/;

// Multi-choice: numbered list items + a "choose one" question
const NUMBERED_LIST_RE  = /^\s*\d+\.\s+\S/m;
const CHOICE_QUESTION_RE = /(which one|please choose|pick one|choose one|select one|which would you|which file)/i;

// Confirmation: model asking for verbal yes/no before acting, or a direct (y/n) prompt
const CONFIRM_RE = /(shall I go ahead|want me to proceed|confirm.*delete|are you sure|shall I proceed|should I go ahead|\(y\/n\))/i;

// Error + recovery offer
const ERROR_RETRY_RE = /(doesn't exist|does not exist|not found|failed|error)[^]*?(would you like|want me to|shall I|did you mean|Enter to)/is;

// Free-text: a question with substantial text before `?`.
// Guards against false positives from Claude Code's own UI elements.
const FREE_TEXT_RE = /(?:[a-zA-Z]{3,}[^?]{6,}\?\s*$|Enter to (?:continue|retry|exit))/i;
// Lines that are part of Claude Code's UI — never treat as interactive questions
const UI_NOISE_RE = /(?:Task \d+:|✔|◼|⏵⏵|shift\+tab|esc to|for shortcuts|brew upgrade|Update available|Bramwick|tokens?\)|thought for|^❯\s|^\s*[\u2800-\u28FF]+\s*$)/i;

// Progress: Claude Code spinner characters + gerund word
const SPINNER_RE       = /[✽✳✻✶·★]\s+\w[^\n]*…/;
const PROGRESS_TOOL_RE = /⏺\s+(Reading|Searching|Writing|Running|Fetching)\s+.+…/;

// Session states
const SHELL_PROMPT_RE = /^❯\s*$/m;
const IDLE_STATUS_RE  = /\? for shortcuts/;
const TOOL_RESULT_RE  = /⎿\s+(Done|Wrote|Created|Ran|Did)/;

// ─── Hook-driven status line (added 2026-05-07) ───────────────────────────
// The user's ant-status hook plugin renders this single line at the bottom
// of the Claude Code corner. See docs/LESSONS.md § 1.12 for the full
// design contract.
//
// Example:
//   sent:10:58:40  resp:10:57:23  edit:10:57:14  |  a-nice-terminal  |  Opus 4.7  |  21m:20%  |  Working
//
// Optional second folder ("launch_folder") only appears when work_folder
// differs from launch_folder. State labels include "Menu (question)" and
// "Menu (plan)" suffixes.
const NEW_STATUS_LINE_RE =
  /sent:(?<sent>\d\d:\d\d:\d\d)\s+resp:(?<resp>\d\d:\d\d:\d\d)\s+edit:(?<edit>\d\d:\d\d:\d\d)\s+\|\s+(?<folder>[^|]+?)(?:\s+\|\s+(?<launch>[^|]+?))?\s+\|\s+(?<model>[^|]+?)\s+\|\s+(?<dur>\d+[hm]):(?<ctx>\d+)%\s+\|\s+(?<state>Working|Waiting|Menu(?:\s\([^)]+\))?|Permission|Response needed|Available)/;

// Claude Code's own spinner: "✢ Tinkering… (19s · still thinking)"
const SPINNER_VERB_RE = /(?<verb>[A-Z][a-z]+(?:ing|king))…\s+\((?<elapsed>\d+s)(?:\s·\s(?:still thinking|esc to interrupt))?\)/;

// Permission mode line: "⏵⏵ bypass permissions on (shift+tab to cycle)"
const PERMISSION_MODE_RE = /⏵⏵\s+(?<mode>[^(]+?)\s+\(shift\+tab to cycle\)/;

// Remote-control indicator (presence-only)
const REMOTE_CONTROL_RE = /Remote Control active/;

// Strip ANSI colour escapes before regex matching so a green-coloured folder
// name in the rendered status line still parses cleanly.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// Combine HH:MM:SS (assumed today, local TZ) with current date → epoch ms.
// Used as a *fallback* only when the state file isn't available; the file
// supplies authoritative full ISO timestamps.
function todayHmsToEpoch(hms: string): number | undefined {
  const m = hms.match(/^(\d\d):(\d\d):(\d\d)$/);
  if (!m) return undefined;
  const [, hh, mm, ss] = m;
  const d = new Date();
  d.setHours(parseInt(hh, 10), parseInt(mm, 10), parseInt(ss, 10), 0);
  return d.getTime();
}

// ─── NormalisedEvent extension (additive — does not break base type) ──────────

export interface ClaudeEvent extends NormalisedEvent {
  class:   EventClass;
  payload: Record<string, unknown>;
}

// ─── ClaudeCodeDriver ─────────────────────────────────────────────────────────

export class ClaudeCodeDriver implements AgentDriver {
  private hooksActive = false;

  /**
   * Toggle hook-based event prioritisation. When true, the driver may skip
   * heuristics that the per-CLI hook plugin already covers more reliably.
   * Currently this is used by `detectStatus()` callers to know whether
   * to also run the perspective classifier as a fallback.
   */
  setHooksActive(active: boolean): void {
    this.hooksActive = active;
  }

  /**
   * Inspect a single raw event line and return a NormalisedEvent if interactive.
   *
   * Single-line detection is sufficient for most cases:
   *  - TUI events trigger on the `❯ 1. Yes` line (appears last in the box)
   *  - Text events trigger on the question/offer line
   *
   * For full context-aware classification (e.g. distinguishing write vs execute),
   * call classifyFromWindow() with the buffered multi-line window instead.
   */
  detect(raw: RawEvent): NormalisedEvent | null {
    const { text, ts } = raw;

    // Skip lines that are part of Claude Code's own UI — task lists, status bar,
    // Bramwick snail, etc. These are never interactive events.
    if (UI_NOISE_RE.test(text)) return null;

    // TUI permission/tool dialog — discriminate by window context when available
    if (OPTION_YES_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'permission_request', { subclass: 'unknown' });
    }

    // Multi-choice (text-level numbered list + question)
    if (CHOICE_QUESTION_RE.test(text) && !DIVIDER_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'multi_choice', { question: text.trim(), options: [] });
    }

    // Confirmation (text-level yes/no offer)
    if (CONFIRM_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'confirmation', { question: text.trim() });
    }

    // Error + recovery
    if (ERROR_RETRY_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'error_retry', { message: text.trim() });
    }

    // Free-text question (must come after multi_choice/confirmation/error_retry guards)
    if (FREE_TEXT_RE.test(text) && !NUMBERED_LIST_RE.test(text) && !DIVIDER_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'free_text', { question: text.trim() });
    }

    // Progress — tool execution indicators that appear in ALL permission modes
    // (bypass, accept-edits, and ask-every-time). These are the ⏺ lines Claude
    // Code emits when starting a tool call.
    if (PROGRESS_TOOL_RE.test(text)) {
      const match = text.match(PROGRESS_TOOL_RE);
      return this.makeEvent(ts, raw.raw, text, 'progress', {
        action: match?.[1] ?? 'Working',
        detail: text.trim(),
      });
    }

    return null;
  }

  /**
   * Context-aware classification over a multi-line buffered window.
   * Call this when the runner has buffered a complete TUI box (after OPTION_YES_RE fires).
   * Provides more accurate subclass/payload than single-line detect().
   */
  classifyFromWindow(window: string, ts: number): ClaudeEvent | null {
    if (!OPTION_YES_RE.test(window)) return null;

    if (HEADER_TOOL_RE.test(window)) {
      const toolMatch = /^\s*(\w.+?\(.+?\))\s*$/m.exec(window);
      return this.makeEvent(ts, window, window, 'tool_auth', {
        tool:        toolMatch?.[1]?.trim() ?? 'unknown',
        description: extractLineAfter(window, HEADER_TOOL_RE),
      });
    }

    if (HEADER_EXECUTE_RE.test(window)) {
      const lines = window.split('\n').map(l => l.trim()).filter(Boolean);
      const cmdIdx = lines.findIndex(l => HEADER_EXECUTE_RE.test(l));
      return this.makeEvent(ts, window, window, 'permission_request', {
        subclass: 'execute',
        command:  lines[cmdIdx + 1] ?? 'unknown',
        description: lines[cmdIdx + 2] ?? '',
      });
    }

    if (HEADER_WRITE_RE.test(window)) {
      const opMatch  = HEADER_WRITE_RE.exec(window);
      const op       = opMatch?.[1] ?? 'Create file';
      const lines    = window.split('\n').map(l => l.trim()).filter(Boolean);
      const opIdx    = lines.findIndex(l => l === op.trim());
      return this.makeEvent(ts, window, window, 'permission_request', {
        subclass: op.toLowerCase().startsWith('create') ? 'write' : 'edit',
        file:     lines[opIdx + 1] ?? 'unknown',
      });
    }

    // Fallback generic permission_request
    return this.makeEvent(ts, window, window, 'permission_request', { subclass: 'unknown' });
  }

  /**
   * Translate the user's choice into tmux key sequences and send them via
   * the injected sendKeys callback.
   */
  async respond(event: NormalisedEvent, choice: UserChoice, sendKeys: SendKeysFn): Promise<void>;
  async respond(event: NormalisedEvent, choice: UserChoice): Promise<void>;
  async respond(event: NormalisedEvent, choice: UserChoice, sendKeys?: SendKeysFn): Promise<void> {
    const keys = this.buildKeys((event as ClaudeEvent).class, choice);
    if (keys === null) return; // progress — no response

    if (!sendKeys) throw new Error('ClaudeCodeDriver.respond requires a sendKeys callback');
    await sendKeys(keys);
  }

  /**
   * Return true once Claude Code has settled after the interactive event.
   */
  isSettled(event: NormalisedEvent, output: RawOutput): boolean {
    const window = output.lines.slice(-20).map(e => e.text).join('\n');
    const eventClass = (event as ClaudeEvent).class;

    switch (eventClass) {
      case 'permission_request':
      case 'tool_auth':
        return (
          !OPTION_YES_RE.test(window) &&
          !DIVIDER_RE.test(window) &&
          (SHELL_PROMPT_RE.test(window) || TOOL_RESULT_RE.test(window))
        );

      case 'multi_choice':
      case 'confirmation':
      case 'free_text':
      case 'error_retry':
        return IDLE_STATUS_RE.test(window) && !SPINNER_RE.test(window);

      case 'progress':
        return IDLE_STATUS_RE.test(window) && !SPINNER_RE.test(window) && !PROGRESS_TOOL_RE.test(window);

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
  ): ClaudeEvent {
    return {
      seq:    0,    // seq assigned by capture pipeline
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
      case 'permission_request':
      case 'tool_auth': {
        if (choice.type === 'approve')                          return ['', 'Enter'];
        if (choice.type === 'deny')                            return ['3', 'Enter'];
        if (choice.type === 'select' && choice.index === 1)    return ['2', 'Enter'];
        return ['', 'Enter'];
      }

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

  /**
   * Return true if this line is Claude Code UI chrome — status bar, spinners,
   * decoration, task list, Bramwick snail, dividers, etc. These are filtered
   * from the terminal text view so only meaningful agent output shows.
   *
   * Based on fingerprint probe run 2026-04-13.
   */
  isChrome(line: string): boolean {
    const t = line.trim();
    if (!t) return true;                                         // blank lines
    if (DIVIDER_RE.test(t)) return true;                         // ─────────
    if (/^❯\s*$/.test(t)) return true;                          // empty prompt
    if (/^[✽✳✻✶✢·★⏺⠂⠐⠈]+\s/.test(t)) return true;            // spinner + text
    if (/^[✽✳✻✶✢·★⏺⠂⠐⠈]+$/.test(t)) return true;             // spinner alone
    if (/^⏵⏵/.test(t)) return true;                             // permission mode indicator
    if (/tokens?\)/.test(t)) return true;                        // token count
    if (/thought for \d/.test(t)) return true;                   // thinking time
    if (/shift\+tab|esc to|for shortcuts|ctrl\+[a-z]/.test(t)) return true; // key hints
    if (/Update available.*brew upgrade/.test(t)) return true;   // update banner
    if (/Bramwick/.test(t)) return true;                         // snail
    if (/Remote Control active/.test(t)) return true;            // RC indicator
    if (/^\s*[\u2800-\u28FF]+\s*$/.test(t)) return true;        // braille-only lines
    if (/^[/\\|_`~\-.\s()*@^×]+$/.test(t)) return true;        // ASCII art (snail etc.)
    if (/^\s*✔\s+Task \d+/.test(t)) return true;                // completed task
    if (/^\s*◼\s+Task \d+/.test(t)) return true;                // pending task
    if (/^\s*⎿\s/.test(t)) return true;                         // tool result bracket
    if (/^\s*\d+\.\s+(Yes|No|Don't)/.test(t)) return true;      // TUI option list
    return false;
  }

  detectStatus(recentLines: string[]): AgentStatus | null {
    const text = recentLines.join('\n');
    const now = Date.now();

    // Determine state
    let state: AgentStatus['state'] = 'unknown';
    let activity: string | undefined;

    if (IDLE_STATUS_RE.test(text) || /👋/.test(text) || /ctx:\d+%/.test(text)) {
      state = 'ready';
    }
    if (/esc to interrupt/.test(text)) {
      state = 'busy';
    }
    if (/thought for \d/i.test(text)) {
      state = 'thinking';
    }

    const progressMatch = text.match(/⏺\s+(Reading|Searching|Writing|Running|Fetching)\s+(.+?)…/);
    if (progressMatch) {
      state = 'busy';
      activity = `${progressMatch[1]} ${progressMatch[2]}`;
    }

    // Extract model from status line patterns
    let model: string | undefined;
    const modelMatch = text.match(/(Opus|Sonnet|Haiku)\s+[\d.]+/i);
    if (modelMatch) model = modelMatch[0];

    // Claude status line: "user@host    workspace branch    Opus 4.6 ..."
    let workspace: string | undefined;
    let branch: string | undefined;
    const statusLine = recentLines.find(line => /ctx:\d+%|5h:\d+%|(Opus|Sonnet|Haiku)\s+[\d.]+/i.test(line));
    if (statusLine) {
      const parts = statusLine.trim().split(/\s{2,}/);
      const workspaceBranch = parts[1];
      const wbMatch = workspaceBranch?.match(/^(.+)\s+([^\s]+)$/);
      if (wbMatch) {
        workspace = wbMatch[1];
        branch = wbMatch[2];
      }
    }

    // Extract token count as a rough context indicator
    let contextUsedPct: number | undefined;
    const ctxMatch = text.match(/ctx:(\d+)%/);
    if (ctxMatch) contextUsedPct = parseInt(ctxMatch[1], 10);

    // Extract rate limit
    let rateLimitPct: number | undefined;
    const rateMatch = text.match(/5h:(\d+)%/);
    if (rateMatch) rateLimitPct = parseInt(rateMatch[1], 10);

    // ─── Hook-driven status-line parse ────────────────────────────────────
    // Look for the ant-status custom status line and the Claude Code spinner.
    // Falls back gracefully when neither is present (older Claude Code, no
    // hook plugin installed) — existing logic above stays authoritative.
    const cleanText = recentLines.map(stripAnsi).join('\n');
    let stateLabel: AgentStateLabel | undefined;
    let permissionMode: string | undefined;
    let remoteControlActive: boolean | undefined;
    let folder: string | undefined;
    let scrapeTimestamps: AgentStatus['timestamps'];

    const newMatch = cleanText.match(NEW_STATUS_LINE_RE);
    if (newMatch?.groups) {
      const g = newMatch.groups;
      folder = g.folder.trim();
      const rawState = g.state.replace(/\s\([^)]+\)/, '');
      stateLabel = rawState as AgentStateLabel;
      // Mirror to legacy state for backward-compat consumers.
      state = legacyStateFromLabel(stateLabel);
      // Backfill model and ctx if not already populated by the older
      // status-line patterns above.
      if (!model) model = g.model.trim();
      if (contextUsedPct == null) {
        contextUsedPct = parseInt(g.ctx, 10);
      }
      // Scrape timestamps as last-resort fallback (local-TZ HH:MM:SS only).
      scrapeTimestamps = {
        sentAt: todayHmsToEpoch(g.sent),
        respAt: todayHmsToEpoch(g.resp),
        editAt: todayHmsToEpoch(g.edit),
      };
    }

    const spinnerMatch = cleanText.match(SPINNER_VERB_RE);
    if (spinnerMatch?.groups) {
      activity = activity ?? `${spinnerMatch.groups.verb} (${spinnerMatch.groups.elapsed})`;
      if (state === 'unknown') state = 'thinking';
    }

    const permMatch = cleanText.match(PERMISSION_MODE_RE);
    if (permMatch?.groups) permissionMode = permMatch.groups.mode.trim();

    if (REMOTE_CONTROL_RE.test(cleanText)) remoteControlActive = true;

    if (state === 'unknown' && !stateLabel) return null;

    let result: AgentStatus = {
      state,
      stateLabel,
      activity,
      model,
      contextUsedPct,
      contextRemainingPct: contextUsedPct != null ? 100 - contextUsedPct : undefined,
      rateLimitPct,
      rateLimitWindow: rateLimitPct != null ? '5h' : undefined,
      workspace,
      branch,
      timestamps: scrapeTimestamps,
      permissionMode,
      remoteControlActive,
      detectedAt: now,
    };

    // ─── State-file merge (authoritative) ─────────────────────────────────
    // When the ant-status hook plugin is installed, the JSON state file
    // wins on overlap because it has full ISO timestamps and the
    // canonical state label. Falls back silently when not available
    // (cross-host, hook plugin not installed, etc.).
    if (folder) {
      result = readMergedAgentState('claude-code', { cwdBasename: folder }, result);
    }

    return result;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractLineAfter(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  if (!match) return '';
  const after = text.slice(match.index + match[0].length).trimStart();
  return after.split('\n')[0]?.trim() ?? '';
}
