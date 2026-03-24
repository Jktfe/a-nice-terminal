import type { Server, Socket } from "socket.io";
import {
  addPtyOutputListener,
  checkSessionHealth,
  createPty,
  destroyPty,
  getPty,
  hasOutputListeners,
  resizePty,
  onResumeCommand,
  onCwdUpdate,
  onCommandResult,
  startKillTimer,
  cancelKillTimer,
} from "../pty-manager.js";
import db from "../db.js";
import { type DbSession } from "../types.js";
import { SAFE_TEXT_LIMIT } from "../constants.js";

function getSession(sessionId: string) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as DbSession | undefined;
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

  // Reload sidebar when a terminal's CWD changes
  onCwdUpdate(() => {
    io.emit("session_list_changed");
  });

  // Broadcast command_result messages to unified session rooms
  onCommandResult((parentSessionId, message) => {
    io.to(parentSessionId).emit("message_created", message);
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

        // Don't spawn a new PTY for archived sessions — show historical output only
        if (session.archived) {
          socket.emit("session_joined", { sessionId, type: session.type, archived: true });
          return;
        }

        try {
          // createPty handles both fresh creation and dtach re-attachment
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

      // 500ms delay: gives reconnecting clients time to re-join the room before
      // we check emptiness. Too short → kill timer starts before re-joining client arrives.
      setTimeout(() => {
        checkRoomEmpty(io, sessionId);
      }, 500);
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
        if (session.archived) {
          socket.emit("error", { message: "Session is archived (read-only)" });
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

    // Let clients poll whether a terminal's dtach session is still alive
    socket.on("check_health", ({ sessionId }: { sessionId: string }) => {
      if (typeof sessionId !== "string" || !sessionId.trim()) return;
      const alive = checkSessionHealth(sessionId);
      socket.emit("session_health", { sessionId, alive });
    });

    socket.on("disconnect", () => {
      // For each session this socket had joined, check if the room is now empty
      for (const sessionId of joinedSessions) {
        // 500ms: match leave_session delay — gives reconnecting clients time to re-join
        setTimeout(() => {
          checkRoomEmpty(io, sessionId);
        }, 500);
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
