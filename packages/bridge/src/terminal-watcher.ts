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

// Matches: ANTchat! [room-name] "message" or ANTchat! [room-name] 'message'
// Threading: ANTchat! [room-name:2026-03-25T10:09:33Z] "reply" threads under that timestamp
// Attribution: ANTchat! [room-name] @SenderName "message" — optional sender identifier
// Brackets optional: ANTchat! room-name "message" also works
const ANTCHAT_RE =
  /ANTchat!\s+\[?([^\]":\s]+)(?::([^\]"\s]+))?\]?\s+(?:@(\S+)\s+)?(?:"([^"]+)"|'([^']+)')/;

// Matches: ANTtask! [room] "task name" status:done assigned:AgentName
const ANTTASK_RE =
  /ANTtask!\s+\[?([^\]"\s]+)\]?\s+(?:"([^"]+)"|'([^']+)')(?:\s+status:(\S+))?(?:\s+assigned:(\S+))?/;

// Matches: ANTfile! [room] "/path/to/file" "description"
const ANTFILE_RE =
  /ANTfile!\s+\[?([^\]"\s]+)\]?\s+(?:"([^"]+)"|'([^']+)')(?:\s+(?:"([^"]+)"|'([^']+)'))?/;

const MAX_LINE_BUFFER = 8192; // 8KB — discard excess to prevent unbounded growth

export interface TerminalCommand {
  sessionId: string;
  target: string;
  content: string;
}

export interface ChatMessage {
  /** Terminal session ID where the message originated */
  sessionId: string;
  /** Human-readable room name */
  roomName: string;
  /** Optional thread timestamp — replies thread under the message at this time */
  threadTs?: string;
  /** Optional sender name — from @SenderName token in the ANTchat! line */
  senderName?: string;
  /** Message content */
  content: string;
}

export interface TaskCommand {
  sessionId: string;
  roomName: string;
  taskName: string;
  status?: string;
  assignedTo?: string;
}

export interface FileCommand {
  sessionId: string;
  roomName: string;
  path: string;
  description?: string;
}

export type TerminalCommandHandler = (cmd: TerminalCommand) => void;
export type ChatMessageHandler = (msg: ChatMessage) => void;
export type TaskCommandHandler = (cmd: TaskCommand) => void;
export type FileCommandHandler = (cmd: FileCommand) => void;

export class TerminalWatcher {
  private baseUrl: string;
  private apiKey?: string;
  private socket: Socket | null = null;
  private lineBuffers = new Map<string, string>();
  private watchedSessions = new Set<string>();
  private handler: TerminalCommandHandler | null = null;
  private chatHandler: ChatMessageHandler | null = null;
  private taskHandler: TaskCommandHandler | null = null;
  private fileHandler: FileCommandHandler | null = null;
  // Dedup: key = `${sessionId}:${roomName}:${content}`, value = timestamp
  private recentChatMessages = new Map<string, number>();
  private static CHAT_DEDUP_TTL_MS = 8000;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  onCommand(handler: TerminalCommandHandler): void {
    this.handler = handler;
  }

  onChatMessage(handler: ChatMessageHandler): void {
    this.chatHandler = handler;
  }

  onTaskCommand(handler: TaskCommandHandler): void {
    this.taskHandler = handler;
  }

  onFileCommand(handler: FileCommandHandler): void {
    this.fileHandler = handler;
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

  /** Write text into a terminal session's PTY input */
  writeToTerminal(sessionId: string, data: string): void {
    if (!this.socket?.connected) {
      console.warn("[terminal-watcher] Cannot write — not connected");
      return;
    }
    this.socket.emit("in", { sid: sessionId, d: data });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.lineBuffers.clear();
  }

  private processChunk(sessionId: string, data: Buffer | Uint8Array): void {
    const raw = Buffer.from(data).toString("utf-8");

    // Fast pre-filter: skip chunks that can't contain our CLI command or ANT protocols.
    // Exception: if the line buffer already has "ANT" content, we must still process
    // complete lines that result from combining the buffer with this chunk.
    if (!raw.includes("ant") && !raw.includes("ANT")) {
      const existing = this.lineBuffers.get(sessionId);
      if (existing) {
        const combined = existing + raw;
        const lines = combined.split(/\r?\n|\r/);
        const incomplete = lines.pop() || "";
        this.lineBuffers.set(sessionId, incomplete.length > MAX_LINE_BUFFER ? "" : incomplete);
        // If the buffer held a partial ANT line, check any now-complete lines
        if (existing.includes("ANT") || existing.includes("ant")) {
          const cleanExisting = stripAnsi(combined);
          const completedLines = cleanExisting.split(/\r?\n|\r/);
          completedLines.pop(); // discard incomplete tail
          for (const line of completedLines) {
            this.matchLine(sessionId, line);
          }
        }
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
    // Check ANTchat! protocol first
    const chatMatch = ANTCHAT_RE.exec(line);
    if (chatMatch) {
      const roomName = chatMatch[1];
      const threadTs = chatMatch[2] || undefined; // optional :timestamp
      const senderName = chatMatch[3] || undefined; // optional @SenderName token
      const chatContent = chatMatch[4] || chatMatch[5]; // content (double/single quotes)

      if (roomName && chatContent) {
        // Dedup: skip if same (session, room, content) was posted within TTL
        const dedupKey = `${sessionId}:${roomName}:${chatContent}`;
        const lastSeen = this.recentChatMessages.get(dedupKey) ?? 0;
        const now = Date.now();
        if (now - lastSeen < TerminalWatcher.CHAT_DEDUP_TTL_MS) return;
        this.recentChatMessages.set(dedupKey, now);
        // Prune old entries to prevent unbounded growth
        if (this.recentChatMessages.size > 200) {
          const cutoff = now - TerminalWatcher.CHAT_DEDUP_TTL_MS;
          for (const [k, ts] of this.recentChatMessages) {
            if (ts < cutoff) this.recentChatMessages.delete(k);
          }
        }

        console.log(
          `[terminal-watcher] ANTchat! in session ${sessionId}: room="${roomName}"${threadTs ? ` thread=${threadTs}` : ""} content="${chatContent.slice(0, 60)}..."`
        );

        if (this.chatHandler) {
          try {
            this.chatHandler({ sessionId, roomName, threadTs, senderName, content: chatContent });
          } catch (err) {
            console.error("[terminal-watcher] Chat handler error:", err);
          }
        }
      }
      return;
    }

    // Check ANTtask! protocol
    const taskMatch = ANTTASK_RE.exec(line);
    if (taskMatch) {
      const roomName = taskMatch[1];
      const taskName = taskMatch[2] || taskMatch[3];
      const status = taskMatch[4];
      const assignedTo = taskMatch[5];

      if (roomName && taskName && this.taskHandler) {
        console.log(`[terminal-watcher] ANTtask! in session ${sessionId}: room="${roomName}" task="${taskName}"`);
        try {
          this.taskHandler({ sessionId, roomName, taskName, status, assignedTo });
        } catch (err) {
          console.error("[terminal-watcher] Task handler error:", err);
        }
      }
      return;
    }

    // Check ANTfile! protocol
    const fileMatch = ANTFILE_RE.exec(line);
    if (fileMatch) {
      const roomName = fileMatch[1];
      const filePath = fileMatch[2] || fileMatch[3];
      const description = fileMatch[4] || fileMatch[5];

      if (roomName && filePath && this.fileHandler) {
        console.log(`[terminal-watcher] ANTfile! in session ${sessionId}: room="${roomName}" file="${filePath}"`);
        try {
          this.fileHandler({ sessionId, roomName, path: filePath, description });
        } catch (err) {
          console.error("[terminal-watcher] File handler error:", err);
        }
      }
      return;
    }

    // Check CLI command pattern
    const match = CLI_CMD_RE.exec(line);
    if (!match) return;

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
