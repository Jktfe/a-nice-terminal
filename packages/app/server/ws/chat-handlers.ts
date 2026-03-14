import type { Server, Socket } from "socket.io";
import db from "../db.js";
import type { DbSession } from "../types.js";

function getSession(sessionId: string) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as DbSession | undefined;
}

export function registerChatHandlers(io: Server): void {
  io.on("connection", (socket: Socket) => {
    const joinedSessions = new Set<string>();

    socket.on("join_session", ({ sessionId }: { sessionId: string }) => {
      if (typeof sessionId !== "string" || !sessionId.trim()) return;
      const session = getSession(sessionId);
      if (!session || session.type !== "conversation") return;

      socket.join(sessionId);
      joinedSessions.add(sessionId);
    });

    socket.on("leave_session", ({ sessionId }: { sessionId: string }) => {
      if (typeof sessionId !== "string" || !sessionId.trim()) return;
      socket.leave(sessionId);
      joinedSessions.delete(sessionId);
    });

    socket.on("stream_chunk", ({ sessionId, messageId, content }: { sessionId: string; messageId: string; content: string }) => {
      if (!sessionId || !messageId || typeof content !== "string") return;

      try {
        const msg = db.prepare("SELECT content, status FROM messages WHERE id = ? AND session_id = ?").get(messageId, sessionId) as any;
        if (!msg || msg.status !== "streaming") return;

        const updated = (msg.content || "") + content;
        db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(updated, messageId);

        // Relay to all clients in the room (including sender for multi-tab support)
        io.to(sessionId).emit("stream_chunk", { sessionId, messageId, content });
      } catch {
        // Non-fatal
      }
    });

    socket.on("stream_end", ({ sessionId, messageId }: { sessionId: string; messageId: string }) => {
      if (!sessionId || !messageId) return;

      try {
        db.prepare("UPDATE messages SET status = 'complete' WHERE id = ? AND session_id = ?").run(messageId, sessionId);
        const updated = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId) as any;
        if (updated) {
          if (updated.metadata) updated.metadata = JSON.parse(updated.metadata);
          if (updated.annotations) updated.annotations = JSON.parse(updated.annotations);
          io.to(sessionId).emit("message_updated", updated);
        }
      } catch {
        // Non-fatal
      }
    });

    socket.on("disconnect", () => {
      joinedSessions.clear();
    });
  });
}
