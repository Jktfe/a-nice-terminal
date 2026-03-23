import { io, type Socket } from "socket.io-client";

/**
 * Watches terminal PTY output for CLI command patterns and forwards
 * parsed commands to a handler. Connects to the ANT server's /terminal
 * namespace and buffers output line-by-line for regex matching.
 *
 * Recognised patterns:
 *   ant send message "<target>" "<content>"
 *   ant post message "<target>" "<content>"
 *   ant send message '<target>' '<content>'
 */

// Matches: ant send/post message "target" "content"
// Supports both double and single quotes
const CLI_CMD_RE =
  /ant\s+(?:send|post)\s+message\s+(?:"([^"]+)"|'([^']+)')\s+(?:"([^"]+)"|'([^']+)')/;

const MAX_LINE_BUFFER = 8192; // 8KB — discard excess to prevent unbounded growth

export interface TerminalCommand {
  sessionId: string;
  target: string;
  content: string;
}

export type TerminalCommandHandler = (cmd: TerminalCommand) => void;

export class TerminalWatcher {
  private baseUrl: string;
  private apiKey?: string;
  private socket: Socket | null = null;
  private lineBuffers = new Map<string, string>();
  private watchedSessions = new Set<string>();
  private handler: TerminalCommandHandler | null = null;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  onCommand(handler: TerminalCommandHandler): void {
    this.handler = handler;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const opts: Record<string, any> = {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        reconnectionAttempts: Infinity,
      };
      if (this.apiKey) {
        opts.auth = { apiKey: this.apiKey };
      }

      this.socket = io(`${this.baseUrl}/terminal`, opts);

      this.socket.on("connect", () => {
        console.log("[terminal-watcher] Connected to /terminal namespace");
        // Re-join sessions after reconnect
        for (const sid of this.watchedSessions) {
          this.socket!.emit("join", { sid });
        }
        resolve();
      });

      this.socket.on("connect_error", (err) => {
        console.error("[terminal-watcher] Connection error:", err.message);
      });

      // Listen for PTY output
      this.socket.on("out", ({ sid, d }: { sid: string; d: Buffer | Uint8Array }) => {
        this.processChunk(sid, d);
      });

      setTimeout(() => {
        if (!this.socket?.connected) {
          this.socket?.disconnect();
          this.socket = null;
          reject(new Error("[terminal-watcher] Failed to connect within 10s"));
        }
      }, 10000);
    });
  }

  watchSession(sessionId: string): void {
    this.watchedSessions.add(sessionId);
    this.lineBuffers.set(sessionId, "");
    this.socket?.emit("join", { sid: sessionId });
  }

  unwatchSession(sessionId: string): void {
    this.watchedSessions.delete(sessionId);
    this.lineBuffers.delete(sessionId);
    this.socket?.emit("leave", { sid: sessionId });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.lineBuffers.clear();
  }

  private processChunk(sessionId: string, data: Buffer | Uint8Array): void {
    const raw = Buffer.from(data).toString("utf-8");

    // Fast pre-filter: skip chunks that can't contain our CLI command
    if (!raw.includes("ant")) {
      // Still need to handle line buffer for continuity, but only if buffer has content
      const existing = this.lineBuffers.get(sessionId);
      if (existing) {
        const combined = existing + raw;
        const lines = combined.split(/\r?\n|\r/);
        const incomplete = lines.pop() || "";
        this.lineBuffers.set(sessionId, incomplete.slice(-MAX_LINE_BUFFER));
      }
      return;
    }

    // Strip ANSI escape sequences for clean regex matching
    const clean = stripAnsi(raw);

    // Accumulate into line buffer, split on \n and \r (progress bars use \r only)
    const existing = this.lineBuffers.get(sessionId) || "";
    const combined = existing + clean;
    const lines = combined.split(/\r?\n|\r/);
    const incomplete = lines.pop() || "";

    // Cap buffer to prevent unbounded growth from streams without line breaks
    this.lineBuffers.set(sessionId, incomplete.length > MAX_LINE_BUFFER ? "" : incomplete);

    for (const line of lines) {
      this.matchLine(sessionId, line);
    }
  }

  private matchLine(sessionId: string, line: string): void {
    const match = CLI_CMD_RE.exec(line);
    if (!match) return;

    // Groups 1/2 are target (double/single quote), 3/4 are content
    const target = match[1] || match[2];
    const content = match[3] || match[4];

    if (!target || !content) return;

    console.log(
      `[terminal-watcher] Captured CLI command in session ${sessionId}: target="${target}" content="${content.slice(0, 60)}..."`
    );

    if (this.handler) {
      try {
        this.handler({ sessionId, target, content });
      } catch (err) {
        console.error("[terminal-watcher] Handler error:", err);
      }
    }
  }
}

/**
 * Strip ANSI escape sequences from terminal output so regex matching
 * works on clean text. Handles CSI, OSC, and single-char escapes.
 */
function stripAnsi(str: string): string {
  // CSI sequences (\x1b[...X), OSC sequences (\x1b]...BEL), charset switches
  return str.replace(
    /\x1b\[[\?]?[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][AB012]|\x1b[>=<]/g,
    ""
  );
}
