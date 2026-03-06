import type { Server, Socket } from "socket.io";
import { nanoid } from "nanoid";
import { createPty, getPty, resizePty } from "../pty-manager.js";
import db from "../db.js";

export function registerSocketHandlers(io: Server) {
  io.on("connection", (socket: Socket) => {

    // Join a session room (works for both terminal and conversation)
    socket.on("join_session", ({ sessionId }: { sessionId: string }) => {
      socket.join(sessionId);

      const session = db
        .prepare("SELECT * FROM sessions WHERE id = ?")
        .get(sessionId) as any;

      if (!session) {
        socket.emit("error", { message: "Session not found" });
        return;
      }

      // If it's a terminal session, set up the PTY
      if (session.type === "terminal") {
        try {
          const ptyProcess = createPty(sessionId, session.shell);

          // Forward PTY output to the client
          const dataHandler = ptyProcess.onData((data: string) => {
            io.to(sessionId).emit("terminal_output", { sessionId, data });
          });

          // Clean up PTY listener when client leaves
          socket.on("leave_session", ({ sessionId: leaveId }: { sessionId: string }) => {
            if (leaveId === sessionId) {
              dataHandler.dispose();
              socket.leave(sessionId);
            }
          });

          socket.on("disconnect", () => {
            dataHandler.dispose();
          });
        } catch (err) {
          console.error(`Failed to create PTY for session ${sessionId}:`, err);
          socket.emit("error", { message: "Failed to create terminal" });
        }
      }

      socket.emit("session_joined", { sessionId, type: session.type });
    });

    // Terminal input from client
    socket.on(
      "terminal_input",
      ({ sessionId, data }: { sessionId: string; data: string }) => {
        if (typeof data !== "string" || data.length > 10_000) return;
        const ptyProcess = getPty(sessionId);
        if (ptyProcess) {
          ptyProcess.write(data);
        }
      }
    );

    // Terminal resize
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
        const validCols = Math.max(1, Math.min(Number(cols) || 120, 500));
        const validRows = Math.max(1, Math.min(Number(rows) || 30, 200));
        resizePty(sessionId, validCols, validRows);
      }
    );

    // Conversation: new message via WebSocket
    socket.on(
      "new_message",
      ({
        sessionId,
        role,
        content,
      }: {
        sessionId: string;
        role: string;
        content: string;
      }) => {
        const validRoles = ["human", "agent", "system"];
        if (!validRoles.includes(role)) { socket.emit("error", { message: "Invalid role" }); return; }
        if (typeof content !== "string" || content.length > 100_000) { socket.emit("error", { message: "Content too large" }); return; }

        const id = nanoid(12);

        db.prepare(
          "INSERT INTO messages (id, session_id, role, content, format, status) VALUES (?, ?, ?, ?, ?, 'complete')"
        ).run(id, sessionId, role, content, "markdown");

        db.prepare(
          "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?"
        ).run(sessionId);

        const message = db
          .prepare("SELECT * FROM messages WHERE id = ?")
          .get(id);

        io.to(sessionId).emit("message_created", message);
      }
    );

    // Streaming: chunk
    socket.on(
      "stream_chunk",
      ({ sessionId, messageId, content }: { sessionId: string; messageId: string; content: string }) => {
        io.to(sessionId).emit("stream_chunk", { messageId, content });
      }
    );

    // Streaming: end
    socket.on(
      "stream_end",
      ({ sessionId, messageId, content }: { sessionId: string; messageId: string; content: string }) => {
        if (typeof content !== "string" || content.length > 100_000) { socket.emit("error", { message: "Content too large" }); return; }

        db.prepare(
          "UPDATE messages SET content = ?, status = 'complete' WHERE id = ?"
        ).run(content, messageId);

        const message = db
          .prepare("SELECT * FROM messages WHERE id = ?")
          .get(messageId);

        io.to(sessionId).emit("message_updated", message);
      }
    );

    socket.on("disconnect", () => {});
  });
}
