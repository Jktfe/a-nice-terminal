/**
 * ghostty-backend.ts — TerminalBackend implementation using Ghostty on macOS.
 *
 * Ghostty has limited AppleScript support so we drive it via System Events
 * keystrokes. All AppleScript is run by spawning `/usr/bin/osascript -e`.
 *
 * Tab tracking caveat: Ghostty does not expose reliable tab IDs over
 * AppleScript. We track sessions in a Map keyed by sessionId and store the
 * creation order (window/tab index at the time of creation) so focus/close
 * operations target the correct tab on a best-effort basis.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import type { TerminalBackend, TerminalInfo, CreateOptions } from "./terminal-backend.js";
import db from "../db.js";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Key code map for common key sequences
// ---------------------------------------------------------------------------
const KEY_CODES: Record<string, string> = {
  "ctrl-c":    "key code 8 using control down",
  "ctrl-d":    "key code 2 using control down",
  "ctrl-z":    "key code 6 using control down",
  "ctrl-l":    "key code 37 using control down",
  "escape":    "key code 53",
  "return":    "key code 36",
  "tab":       "key code 48",
  "up":        "key code 126",
  "down":      "key code 125",
  "left":      "key code 123",
  "right":     "key code 124",
  "backspace": "key code 51",
  "delete":    "key code 117",
  "home":      "key code 115",
  "end":       "key code 119",
  "pageup":    "key code 116",
  "pagedown":  "key code 121",
};

// ---------------------------------------------------------------------------
// Internal tracking record for each managed terminal
// ---------------------------------------------------------------------------
interface TabRecord {
  sessionId: string;
  /** Best-effort tab index recorded at creation time (1-based) */
  tabIndex: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run an AppleScript snippet via osascript and return trimmed stdout. */
async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execFileP("/usr/bin/osascript", ["-e", script]);
  return stdout.trim();
}

/** Escape a string for safe embedding inside an AppleScript string literal. */
function escapeForAppleScript(text: string): string {
  // AppleScript string literals use double-quotes; escape backslash and quote.
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Wrap a string in POSIX single-quotes for safe shell embedding.
 * Single-quotes cannot be escaped inside single-quote strings in POSIX sh,
 * so any embedded ' is handled by ending the quoted region, inserting a
 * literal ', then resuming: foo'bar → 'foo'\''bar'
 */
function posixSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Check whether Ghostty.app is currently running. */
async function isGhosttyRunning(): Promise<boolean> {
  try {
    const result = await runAppleScript(
      'tell application "System Events" to (name of processes) contains "Ghostty"'
    );
    return result === "true";
  } catch {
    return false;
  }
}

/** Activate (launch or foreground) Ghostty. */
async function activateGhostty(): Promise<void> {
  await runAppleScript('tell application "Ghostty" to activate');
  // Give the app a moment to open/focus before sending keystrokes.
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
}

// ---------------------------------------------------------------------------
// GhosttyBackend
// ---------------------------------------------------------------------------

export class GhosttyBackend implements TerminalBackend {
  /** Internal map: sessionId → tab tracking record */
  private tabs = new Map<string, TabRecord>();

  /** Running tab index counter — incremented on each create() call. */
  private nextTabIndex = 1;

  // ─── isAvailable ──────────────────────────────────────────────────────────

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "darwin") return false;
    return existsSync("/Applications/Ghostty.app");
  }

  // ─── Guard helper ─────────────────────────────────────────────────────────

  private async assertAvailable(): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error("Ghostty is not installed. Install from https://ghostty.org");
    }
  }

  // ─── create ───────────────────────────────────────────────────────────────

  async create(opts: CreateOptions): Promise<TerminalInfo> {
    await this.assertAvailable();

    const { sessionId, cwd, command, title } = opts;

    // Launch / foreground Ghostty
    const wasRunning = await isGhosttyRunning();
    await activateGhostty();

    if (wasRunning) {
      // Open a new tab with Cmd+T
      await runAppleScript(
        'tell application "System Events" to keystroke "t" using command down'
      );
      // Brief pause so the tab is ready to accept input
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
    }
    // If Ghostty was not running, activating it already opens a fresh window/tab.

    // Record tab position
    const tabIndex = this.nextTabIndex++;
    this.tabs.set(sessionId, { sessionId, tabIndex, createdAt: Date.now() });

    // Build the start command
    const shell = process.env.SHELL ?? "/bin/zsh";
    const antCapture = "ant-capture"; // resolved via PATH; symlinked during install

    let startCommand: string;
    if (command) {
      startCommand = command;
    } else {
      startCommand = `${antCapture} ${sessionId} ${shell}`;
    }

    if (cwd) {
      await this.sendTypedLine(`cd ${posixSingleQuote(cwd)} && ${startCommand}`);
    } else {
      await this.sendTypedLine(startCommand);
    }

    // Set tab title via OSC 2 escape sequence if requested.
    // Assign to a variable first so the title is never interpreted as shell syntax.
    if (title) {
      await this.sendTypedLine(`_t=${posixSingleQuote(title)}; printf '\\033]2;%s\\007' "$_t"`);
    }

    return { id: sessionId };
  }

  // ─── input ────────────────────────────────────────────────────────────────

  async input(sessionId: string, text: string): Promise<void> {
    await this.assertAvailable();
    await this.focusTab(sessionId);

    // Send text line by line to avoid AppleScript keystroke length limits
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 0) {
        const escaped = escapeForAppleScript(line);
        await runAppleScript(
          `tell application "System Events" to keystroke "${escaped}"`
        );
      }
      // Send Return between lines (but not after the final empty segment when
      // the caller already included a trailing \n)
      if (i < lines.length - 1) {
        await runAppleScript(
          'tell application "System Events" to key code 36'
        );
      }
    }
  }

  // ─── sendKey ──────────────────────────────────────────────────────────────

  async sendKey(sessionId: string, key: string): Promise<void> {
    await this.assertAvailable();
    await this.focusTab(sessionId);

    const keyCode = KEY_CODES[key.toLowerCase()];
    if (!keyCode) {
      throw new Error(`Unknown key name: "${key}". Known keys: ${Object.keys(KEY_CODES).join(", ")}`);
    }

    await runAppleScript(`tell application "System Events" to ${keyCode}`);
  }

  // ─── exec (run command and wait for shell hook completion event) ──────────

  async runAndWait(sessionId: string, command: string, timeoutMs = 30_000): Promise<{ exitCode: number }> {
    await this.assertAvailable();

    // Send the command with a trailing newline
    await this.input(sessionId, command + "\n");

    // Poll command_events in SQLite waiting for a completed row for this session
    const deadline = Date.now() + timeoutMs;
    const pollInterval = 500;

    const stmt = db.prepare<[string, string], { exit_code: number | null }>(
      `SELECT exit_code FROM command_events
       WHERE session_id = ? AND command = ? AND completed_at IS NOT NULL
       ORDER BY started_at DESC
       LIMIT 1`
    );

    return new Promise<{ exitCode: number }>((resolve, reject) => {
      const poll = () => {
        const row = stmt.get(sessionId, command);
        if (row) {
          resolve({ exitCode: row.exit_code ?? 0 });
          return;
        }
        if (Date.now() >= deadline) {
          reject(
            new Error(`runAndWait() timed out after ${timeoutMs}ms waiting for: ${command}`)
          );
          return;
        }
        setTimeout(poll, pollInterval);
      };
      poll();
    });
  }

  // ─── exec (required by TerminalBackend interface) ─────────────────────────

  async exec(sessionId: string, command: string, timeoutMs?: number): Promise<{ exitCode: number }> {
    return this.runAndWait(sessionId, command, timeoutMs);
  }

  // ─── focus ────────────────────────────────────────────────────────────────

  async focus(sessionId: string): Promise<void> {
    await this.assertAvailable();
    await this.focusTab(sessionId);
  }

  // ─── close ────────────────────────────────────────────────────────────────

  async close(sessionId: string): Promise<void> {
    await this.assertAvailable();
    await this.focusTab(sessionId);

    // Cmd+W closes the current tab in Ghostty
    await runAppleScript(
      'tell application "System Events" to key code 13 using command down'
    );

    this.tabs.delete(sessionId);
  }

  // ─── list ─────────────────────────────────────────────────────────────────

  async list(): Promise<TerminalInfo[]> {
    return Array.from(this.tabs.values()).map((rec) => ({
      id: rec.sessionId,
    }));
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Bring Ghostty to the front and navigate to the tracked tab.
   *
   * Ghostty supports Cmd+<number> for tabs 1-9. For tabs beyond that,
   * we can only activate the app and leave focus on the current tab.
   */
  private async focusTab(sessionId: string): Promise<void> {
    await activateGhostty();

    const record = this.tabs.get(sessionId);
    if (!record) {
      // Session not tracked by this backend instance — leave focus as-is.
      return;
    }

    if (record.tabIndex >= 1 && record.tabIndex <= 9) {
      await runAppleScript(
        `tell application "System Events" to keystroke "${record.tabIndex}" using command down`
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
    }
    // Tab index > 9: no reliable AppleScript mechanism; app is at least foregrounded.
  }

  /** Type a full line and press Return. */
  private async sendTypedLine(line: string): Promise<void> {
    const escaped = escapeForAppleScript(line);
    await runAppleScript(
      `tell application "System Events" to keystroke "${escaped}"`
    );
    await runAppleScript(
      'tell application "System Events" to key code 36'
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
}
