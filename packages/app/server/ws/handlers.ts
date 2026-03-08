import type { Server, Socket } from "socket.io";
import { nanoid } from "nanoid";
import {
  addPtyOutputListener,
  createPty,
  destroyPty,
  getPty,
  hasOutputListeners,
  hasTmuxSession,
  resizePty,
  onResumeCommand,
  startKillTimer,
  cancelKillTimer,
} from "../pty-manager.js";
import db from "../db.js";
import type { DbSession, DbMessage } from "../types.js";

type Role = "human" | "agent" | "system";

type StreamChunkPayload = {
  sessionId: string;
  messageId: string;
  content: string;
};

const VALID_FORMATS = new Set(["markdown", "text", "plaintext", "json"]);
const SAFE_TEXT_LIMIT = 10_000;

function normalizeRole(role: string): Role | null {
  switch (role) {
    case "human":
    case "user":
      return "human";
    case "agent":
    case "assistant":
      return "agent";
    case "system":
      return "system";
    default:
      return null;
  }
}

function getSession(sessionId: string) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as DbSession | undefined;
}

function getMessage(messageId: string, sessionId: string) {
  return db.prepare("SELECT * FROM messages WHERE id = ? AND session_id = ?").get(messageId, sessionId) as DbMessage | undefined;
}

/**
 * Check if a Socket.IO room has any connected clients.
 */
function roomHasClients(io: Server, room: string): boolean {
  const clients = io.sockets.adapter.rooms.get(room);
  return !!clients && clients.size > 0;
}

export function registerSocketHandlers(io: Server) {
  // Broadcast newly captured resume commands to all clients
  onResumeCommand((cmd) => {
    io.emit("resume_command_captured", cmd);
  });

  io.on("connection", (socket: Socket) => {
    // Track which sessions this socket has joined (for cleanup on disconnect)
    const joinedSessions = new Set<string>();

    socket.on("join_session", ({ sessionId }: { sessionId: string }) => {
      if (typeof sessionId !== "string" || !sessionId.trim()) {
        socket.emit("error", { message: "Invalid sessionId" });
        return;
      }

      const session = getSession(sessionId);
      if (!session) {
        socket.emit("error", { message: "Session not found" });
        return;
      }

      socket.join(sessionId);
      joinedSessions.add(sessionId);

      if (session.type === "terminal") {
        // A client is watching — cancel any pending kill timer
        cancelKillTimer(sessionId);

        try {
          // createPty handles both fresh creation and tmux re-attachment
          getPty(sessionId) || createPty(sessionId, session.shell, session.cwd);
          if (!hasOutputListeners(sessionId)) {
            const emitter = (chunk: string) => {
              io.to(sessionId).emit("terminal_output", { sessionId, data: chunk });
            };

            addPtyOutputListener(sessionId, emitter);
          }
        } catch (err) {
          console.error(`Failed to create PTY for session ${sessionId}:`, err);
          socket.emit("error", { message: "Failed to create terminal" });
          return;
        }
      }

      socket.emit("session_joined", { sessionId, type: session.type });
    });

    socket.on("leave_session", ({ sessionId }: { sessionId: string }) => {
      if (typeof sessionId !== "string" || !sessionId.trim()) return;
      socket.leave(sessionId);
      joinedSessions.delete(sessionId);

      // Check if this was the last client in the room
      // Use setTimeout(0) to let Socket.IO finish the leave before checking
      setTimeout(() => {
        checkRoomEmpty(io, sessionId);
      }, 0);
    });

    socket.on(
      "terminal_input",
      ({ sessionId, data }: { sessionId: string; data: string }) => {
        if (typeof sessionId !== "string" || !sessionId.trim()) return;
        if (typeof data !== "string" || data.length > SAFE_TEXT_LIMIT) {
          socket.emit("error", { message: "Invalid input payload" });
          return;
        }

        const session = getSession(sessionId);
        if (!session) {
          socket.emit("error", { message: "Session not found" });
          return;
        }
        if (session.type !== "terminal") {
          socket.emit("error", { message: "Not a terminal session" });
          return;
        }

        let ptyProcess = getPty(sessionId);
        if (!ptyProcess) {
          try {
            ptyProcess = createPty(sessionId, session.shell, session.cwd);
          } catch (err) {
            socket.emit("error", { message: "Failed to create terminal" });
            return;
          }

          if (!hasOutputListeners(sessionId)) {
            const emitter = (chunk: string) => {
              io.to(sessionId).emit("terminal_output", { sessionId, data: chunk });
            };
            addPtyOutputListener(sessionId, emitter);
          }
        }

        try {
          ptyProcess.write(data);
        } catch (err) {
          try {
            destroyPty(sessionId);
            const recreated = createPty(sessionId, session.shell, session.cwd);
            recreated.write(data);

            if (!hasOutputListeners(sessionId)) {
              const emitter = (chunk: string) => {
                io.to(sessionId).emit("terminal_output", { sessionId, data: chunk });
              };
              addPtyOutputListener(sessionId, emitter);
            }
          } catch (writeError) {
            socket.emit("error", { message: "Failed to write terminal input" });
            return;
          }
        }
      }
    );

    socket.on(
      "terminal_resize",
      ({
        sessionId,
        cols,
        rows,
      }: {
        sessionId: string;
        cols: number;
        rows: number;
      }) => {
        if (typeof sessionId !== "string" || !sessionId.trim()) return;
        if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
          socket.emit("error", { message: "Invalid terminal size" });
          return;
        }

        const session = getSession(sessionId);
        if (!session || session.type !== "terminal") {
          socket.emit("error", { message: "Not a terminal session" });
          return;
        }

        const safeCols = Math.max(1, Math.min(Math.trunc(cols), 500));
        const safeRows = Math.max(1, Math.min(Math.trunc(rows), 200));
        resizePty(sessionId, safeCols, safeRows);
      }
    );

    socket.on(
      "new_message",
      ({
        sessionId,
        role,
        content,
        format = "markdown",
      }: {
        sessionId: string;
        role: string;
        content: string;
        format?: string;
      }) => {
        if (typeof sessionId !== "string" || !sessionId.trim()) return;

        const normalisedRole = normalizeRole(role);
        if (!normalisedRole) {
          socket.emit("error", { message: "Invalid role" });
          return;
        }

        if (typeof content !== "string" || content.length > 100_000) {
          socket.emit("error", { message: "Content too large" });
          return;
        }

        if (!format || typeof format !== "string" || !VALID_FORMATS.has(format)) {
          socket.emit("error", { message: "Invalid format" });
          return;
        }

        const session = getSession(sessionId);
        if (!session) {
          socket.emit("error", { message: "Session not found" });
          return;
        }
        if (session.type !== "conversation") {
          socket.emit("error", {
            message: "Only conversation sessions accept messages",
          });
          return;
        }

        const id = nanoid(12);
        db.prepare(
          "INSERT INTO messages (id, session_id, role, content, format, status) VALUES (?, ?, ?, ?, ?, 'complete')"
        ).run(id, sessionId, normalisedRole, content, format);
        db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);

        const message = db.prepare("SELECT * FROM messages WHERE id = ?").get(id);
        io.to(sessionId).emit("message_created", message);
      }
    );

    socket.on(
      "stream_chunk",
      ({ sessionId, messageId, content }: StreamChunkPayload) => {
        if (
          typeof sessionId !== "string" ||
          !sessionId.trim() ||
          typeof messageId !== "string" ||
          !messageId.trim() ||
          typeof content !== "string"
        ) {
          return;
        }

        const session = getSession(sessionId);
        if (!session || session.type !== "conversation") {
          socket.emit("error", {
            message: "Only conversation sessions accept stream chunks",
          });
          return;
        }

        const msg = getMessage(messageId, sessionId);

        if (!msg) {
          socket.emit("error", { message: "Message not found" });
          return;
        }

        if (content.length > 100_000) {
          socket.emit("error", { message: "Chunk too large" });
          return;
        }

        io.to(sessionId).emit("stream_chunk", {
          sessionId,
          messageId,
          role: msg.role,
          format: msg.format,
          content,
        });
      }
    );

    socket.on(
      "stream_end",
      ({ sessionId, messageId, content }: { sessionId: string; messageId: string; content: string }) => {
        if (
          typeof sessionId !== "string" ||
          !sessionId.trim() ||
          typeof messageId !== "string" ||
          !messageId.trim() ||
          typeof content !== "string"
        ) {
          return;
        }

        const session = getSession(sessionId);
        if (!session || session.type !== "conversation") {
          socket.emit("error", {
            message: "Only conversation sessions accept stream completion",
          });
          return;
        }

        if (content.length > 100_000) {
          socket.emit("error", { message: "Content too large" });
          return;
        }

        const existing = getMessage(messageId, sessionId);
        if (!existing) {
          socket.emit("error", { message: "Message not found" });
          return;
        }

        const updatedContent = `${existing.content || ""}${content}`;
        db.prepare(
          "UPDATE messages SET content = ?, status = 'complete' WHERE id = ?"
        ).run(updatedContent, messageId);

        db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
        const updated = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
        io.to(sessionId).emit("message_updated", updated);
      }
    );

    socket.on("disconnect", () => {
      // For each session this socket had joined, check if the room is now empty
      for (const sessionId of joinedSessions) {
        // Small delay to let Socket.IO clean up the room membership
        setTimeout(() => {
          checkRoomEmpty(io, sessionId);
        }, 100);
      }
      joinedSessions.clear();
    });
  });
}

/**
 * If no clients remain in a terminal session's room, start the kill timer.
 */
function checkRoomEmpty(io: Server, sessionId: string) {
  const session = getSession(sessionId);
  if (!session || session.type !== "terminal") return;

  if (!roomHasClients(io, sessionId)) {
    console.log(`[ws] No clients remain for session ${sessionId} — starting kill timer`);
    startKillTimer(sessionId);
  }
}
