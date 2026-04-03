/**
 * CommandTracker — detects command lifecycle from terminal output.
 *
 * Detection methods (in priority order):
 * 1. OSC 133 shell integration sequences (exact boundaries + exit code)
 * 2. Quiet-period detection (500ms silence → idle)
 *
 * Emits: command_start, command_end, idle
 */
import { EventEmitter } from "node:events";
import { stripAnsi } from "../types.js";

export type ShellState = "idle" | "running";
export type DetectionMethod = "osc133" | "quiet";

export interface CommandEvent {
  command: string;
  exitCode?: number;
  output?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  cwd?: string;
  detectionMethod: DetectionMethod;
}

// OSC 133 sequences (used by iTerm2 shell integration, Kitty, etc.)
// A = prompt start, B = prompt end, C = command start, D = command end (with exit code)
const OSC133_A = /\x1b\]133;A/;  // Prompt start
const OSC133_C = /\x1b\]133;C/;  // Command start (user pressed Enter)
const OSC133_D = /\x1b\]133;D(?:;(\d+))?/;  // Command end, optional exit code

// OSC 133 B + preexec: some shells emit the command text
const OSC133_B = /\x1b\]133;B/;  // Command line ready

const QUIET_TIMEOUT_MS = 500;

export class CommandTracker extends EventEmitter {
  private shellState: ShellState = "idle";
  private currentCommand: string | null = null;
  private commandStartedAt: string | null = null;
  private outputBuffer: string[] = [];
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private hasOsc133 = false;
  private lastPromptLine: string | null = null;

  get state(): ShellState {
    return this.shellState;
  }

  get usingOsc133(): boolean {
    return this.hasOsc133;
  }

  /**
   * Feed raw terminal output into the tracker.
   * Call this for every chunk from the PTY.
   */
  feed(data: string): void {
    // Check for OSC 133 sequences
    if (this.checkOsc133(data)) return;

    // Quiet-period fallback: reset timer on every output chunk
    if (this.shellState === "running") {
      this.outputBuffer.push(data);
      this.resetQuietTimer();
    }
  }

  /**
   * Notify the tracker that input was sent to the terminal.
   * Used to detect command starts in quiet-period mode.
   */
  inputSent(data: string): void {
    if (this.hasOsc133) return; // OSC 133 handles this

    // If Enter was pressed and we're idle, start a command
    if ((data.includes("\r") || data.includes("\n")) && this.shellState === "idle") {
      this.shellState = "running";
      this.commandStartedAt = new Date().toISOString();
      this.currentCommand = data.trim() || "(unknown)";
      this.outputBuffer = [];
      this.emit("command_start", {
        command: this.currentCommand,
        startedAt: this.commandStartedAt,
        detectionMethod: "quiet" as DetectionMethod,
      });
      this.resetQuietTimer();
    }
  }

  private checkOsc133(data: string): boolean {
    let handled = false;

    // Check for prompt start (A) — indicates shell is idle/ready
    if (OSC133_A.test(data)) {
      this.hasOsc133 = true;
      handled = true;

      if (this.shellState === "running" && this.commandStartedAt) {
        // Command ended (prompt returned)
        this.completeCommand(undefined, "osc133");
      }
      this.shellState = "idle";
      this.cancelQuietTimer();
      this.emit("idle");
    }

    // Check for command start (C) — user pressed Enter
    if (OSC133_C.test(data)) {
      this.hasOsc133 = true;
      handled = true;

      this.shellState = "running";
      this.commandStartedAt = new Date().toISOString();
      this.outputBuffer = [];

      // Try to extract the command from the prompt line
      const plain = stripAnsi(data);
      // Command text is typically between B and C markers
      this.currentCommand = this.lastPromptLine || plain.trim() || "(unknown)";

      this.emit("command_start", {
        command: this.currentCommand,
        startedAt: this.commandStartedAt,
        detectionMethod: "osc133" as DetectionMethod,
      });
    }

    // Check for prompt line ready (B) — capture the command text
    if (OSC133_B.test(data)) {
      this.hasOsc133 = true;
      // The text between A and B markers is the prompt; text after B is the command
      const plain = stripAnsi(data);
      const parts = plain.split(/\x1b\]133;B/);
      this.lastPromptLine = parts.length > 1 ? parts[1].trim() : plain.trim();
    }

    // Check for command end (D) — with optional exit code
    const endMatch = OSC133_D.exec(data);
    if (endMatch) {
      this.hasOsc133 = true;
      handled = true;

      const exitCode = endMatch[1] !== undefined ? parseInt(endMatch[1], 10) : undefined;
      this.completeCommand(exitCode, "osc133");
      this.shellState = "idle";
      this.cancelQuietTimer();
      this.emit("idle");
    }

    return handled;
  }

  private completeCommand(exitCode: number | undefined, method: DetectionMethod): void {
    if (!this.commandStartedAt) return;

    const now = new Date().toISOString();
    const startMs = new Date(this.commandStartedAt).getTime();
    const endMs = new Date(now).getTime();

    const event: CommandEvent = {
      command: this.currentCommand || "(unknown)",
      exitCode,
      output: stripAnsi(this.outputBuffer.join("")),
      startedAt: this.commandStartedAt,
      completedAt: now,
      durationMs: endMs - startMs,
      detectionMethod: method,
    };

    this.emit("command_end", event);

    this.currentCommand = null;
    this.commandStartedAt = null;
    this.outputBuffer = [];
  }

  private resetQuietTimer(): void {
    this.cancelQuietTimer();
    this.quietTimer = setTimeout(() => {
      if (this.shellState === "running" && !this.hasOsc133) {
        // No output for 500ms — assume command is done
        this.completeCommand(undefined, "quiet");
        this.shellState = "idle";
        this.emit("idle");
      }
    }, QUIET_TIMEOUT_MS);
  }

  private cancelQuietTimer(): void {
    if (this.quietTimer) {
      clearTimeout(this.quietTimer);
      this.quietTimer = null;
    }
  }

  dispose(): void {
    this.cancelQuietTimer();
    this.removeAllListeners();
  }
}
