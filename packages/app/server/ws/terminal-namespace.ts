/**
 * Dedicated Socket.IO namespace for terminal I/O.
 *
 * Separates high-frequency binary terminal traffic from the control-plane
 * namespace. All payloads are binary-first (Uint8Array / Buffer).
 *
 * Protocol:
 *   join   (client→server)  { sid }
 *   leave  (client→server)  { sid }
 *   in     (client→server)  { sid, d: Uint8Array }
 *   out    (server→client)  { sid, d: Uint8Array }
 *   resize (client→server)  { sid, cols, rows }
 *   state  (server→client)  { sid, screen, cursorX, cursorY, cols, rows }
 *   cmd_start (server→client) { sid, command }
 *   cmd_end   (server→client) { sid, command, exitCode, durationMs }
 */
import type { Server, Namespace, Socket } from "socket.io";
import {
  addPtyOutputListener,
  createPty,
  destroyPty,
  getPty,
  getCommandTracker,
  hasOutputListeners,
  resizePty,
  startKillTimer,
  cancelKillTimer,
  onCommandLifecycle,
} from "../pty-manager.js";
import db from "../db.js";
import type { DbSession } from "../types.js";
import { SAFE_TEXT_LIMIT } from "../constants.js";

// Matches terminal-emitted response sequences — block these from reaching the PTY
const TERM_RESPONSE_RE = /^\x1b\[\??[>]?[\d;]*c$|^\x1b\[\d+;\d+[Rn]$|^\x1b\[\d*n$/;

function getSession(sessionId: string) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as DbSession | undefined;
}

function roomHasClients(ns: Namespace, room: string): boolean {
  const clients = ns.adapter.rooms.get(room);
  return !!clients && clients.size > 0;
}

export function registerTerminalNamespace(io: Server): Namespace {
  const termNs = io.of("/terminal");

  // Track which sessions already have a terminal-namespace output emitter,
  // so we add exactly one per session (broadcasts to all clients in the room).
  const termNsEmitters = new Set<string>();

  // Broadcast command lifecycle events to terminal namespace clients
  onCommandLifecycle((event, sessionId, data) => {
    if (event === "command_start") {
      termNs.to(sessionId).emit("cmd_start", {
        sid: sessionId,
        command: data.command,
      });
    } else if (event === "command_end") {
      termNs.to(sessionId).emit("cmd_end", {
        sid: sessionId,
        command: data.command,
        exitCode: data.exitCode,
        durationMs: data.durationMs,
      });
    }
  });

  termNs.on("connection", (socket: Socket) => {
    const joinedSessions = new Set<string>();

    socket.on("join", ({ sid }: { sid: string }) => {
      if (typeof sid !== "string" || !sid.trim()) {
        socket.emit("error", { message: "Invalid sid" });
        return;
      }

      const session = getSession(sid);
      if (!session) {
        socket.emit("error", { message: "Session not found" });
        return;
      }
      if (session.type !== "terminal") {
        socket.emit("error", { message: "Not a terminal session" });
        return;
      }

      socket.join(sid);
      joinedSessions.add(sid);

      // A client is watching — cancel any pending kill timer
      cancelKillTimer(sid);

      try {
        getPty(sid) || createPty(sid, session.shell, session.cwd);
        // Add exactly one terminal-namespace emitter per session.
        // It broadcasts to all /terminal clients in the room.
        if (!termNsEmitters.has(sid)) {
          termNsEmitters.add(sid);
          const emitter = (chunk: string) => {
            const buf = Buffer.from(chunk, "utf-8");
            termNs.to(sid).emit("out", { sid, d: buf });
          };
          addPtyOutputListener(sid, emitter);
        }
      } catch (err) {
        console.error(`[terminal-ns] Failed to create PTY for ${sid}:`, err);
        socket.emit("error", { message: "Failed to create terminal" });
        return;
      }

      socket.emit("joined", { sid, type: session.type });
    });

    socket.on("leave", ({ sid }: { sid: string }) => {
      if (typeof sid !== "string" || !sid.trim()) return;
      socket.leave(sid);
      joinedSessions.delete(sid);

      setTimeout(() => {
        checkRoomEmpty(termNs, sid);
      }, 500);
    });

    socket.on("in", ({ sid, d }: { sid: string; d: Buffer | Uint8Array | string }) => {
      if (typeof sid !== "string" || !sid.trim()) return;

      // Accept Buffer, Uint8Array, or string
      let data: string;
      if (typeof d === "string") {
        data = d;
      } else if (Buffer.isBuffer(d) || d instanceof Uint8Array) {
        data = Buffer.from(d).toString("utf-8");
      } else {
        socket.emit("error", { message: "Invalid input payload" });
        return;
      }

      if (data.length > SAFE_TEXT_LIMIT) {
        socket.emit("error", { message: "Input too large" });
        return;
      }

      // Block terminal response sequences
      if (TERM_RESPONSE_RE.test(data)) return;

      const session = getSession(sid);
      if (!session || session.type !== "terminal") {
        socket.emit("error", { message: "Not a terminal session" });
        return;
      }

      let ptyProcess = getPty(sid);
      if (!ptyProcess) {
        try {
          ptyProcess = createPty(sid, session.shell, session.cwd);
          if (!hasOutputListeners(sid)) {
            const emitter = (chunk: string) => {
              const buf = Buffer.from(chunk, "utf-8");
              termNs.to(sid).emit("out", { sid, d: buf });
            };
            addPtyOutputListener(sid, emitter);
          }
        } catch {
          socket.emit("error", { message: "Failed to create terminal" });
          return;
        }
      }

      try {
        ptyProcess.write(data);
        // Notify command tracker of input for quiet-period detection
        getCommandTracker(sid)?.inputSent(data);
      } catch {
        try {
          destroyPty(sid);
          const recreated = createPty(sid, session.shell, session.cwd);
          recreated.write(data);
          getCommandTracker(sid)?.inputSent(data);
          if (!hasOutputListeners(sid)) {
            const emitter = (chunk: string) => {
              const buf = Buffer.from(chunk, "utf-8");
              termNs.to(sid).emit("out", { sid, d: buf });
            };
            addPtyOutputListener(sid, emitter);
          }
        } catch {
          socket.emit("error", { message: "Failed to write terminal input" });
        }
      }
    });

    socket.on("resize", ({ sid, cols, rows }: { sid: string; cols: number; rows: number }) => {
      if (typeof sid !== "string" || !sid.trim()) return;
      if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
        socket.emit("error", { message: "Invalid terminal size" });
        return;
      }

      const session = getSession(sid);
      if (!session || session.type !== "terminal") {
        socket.emit("error", { message: "Not a terminal session" });
        return;
      }

      const safeCols = Math.max(1, Math.min(Math.trunc(cols), 500));
      const safeRows = Math.max(1, Math.min(Math.trunc(rows), 200));
      resizePty(sid, safeCols, safeRows);
    });

    socket.on("disconnect", () => {
      for (const sid of joinedSessions) {
        setTimeout(() => {
          checkRoomEmpty(termNs, sid);
        }, 500);
      }
      joinedSessions.clear();
    });
  });

  return termNs;
}

function checkRoomEmpty(ns: Namespace, sessionId: string) {
  const session = getSession(sessionId);
  if (!session || session.type !== "terminal") return;

  if (!roomHasClients(ns, sessionId)) {
    console.log(`[terminal-ns] No clients remain for ${sessionId} — starting kill timer`);
    startKillTimer(sessionId);
  }
}
