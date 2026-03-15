/**
 * Agent API — structured REST + SSE endpoints for AI agents.
 *
 * These endpoints give agents the same clarity as a human watching the screen:
 * clean text, cursor position, command exit codes, and the ability to wait
 * for commands to complete.
 *
 * All endpoints reuse the existing ANT_API_KEY auth mechanism.
 */
import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import type { DbSession } from "../types.js";
import {
  createPty,
  getPty,
  getHeadless,
  getCommandTracker,
  addPtyOutputListener,
  hasOutputListeners,
  hasTmuxSession,
  onCommandLifecycle,
} from "../pty-manager.js";
import { SAFE_TEXT_LIMIT } from "../constants.js";

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/agent/sessions — list sessions with structured metadata
// ---------------------------------------------------------------------------
router.get("/api/agent/sessions", (_req, res) => {
  const sessions = db.prepare(
    "SELECT * FROM sessions WHERE archived = 0 ORDER BY updated_at DESC"
  ).all() as DbSession[];

  const result = sessions.map((s) => {
    const tracker = getCommandTracker(s.id);
    return {
      id: s.id,
      name: s.name,
      type: s.type,
      cwd: s.cwd,
      shellState: tracker?.state ?? (hasTmuxSession(s.id) ? "unknown" : "dead"),
      hasHeadless: !!getHeadless(s.id),
      created_at: s.created_at,
      updated_at: s.updated_at,
    };
  });

  res.json(result);
});

// ---------------------------------------------------------------------------
// GET /api/agent/sessions/:id/screen — structured screen state
// ---------------------------------------------------------------------------
router.get("/api/agent/sessions/:id/screen", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") return res.status(409).json({ error: "Not a terminal session" });

  const headless = getHeadless(session.id);
  if (!headless) {
    return res.status(503).json({
      error: "Terminal not attached",
      details: "The terminal session exists but has no active PTY. Join it first via WebSocket or create input.",
    });
  }

  const tracker = getCommandTracker(session.id);
  const cursor = headless.getCursor();
  const dims = headless.getDimensions();

  res.json({
    lines: headless.getScreenLines(),
    cursorX: cursor.x,
    cursorY: cursor.y,
    cols: dims.cols,
    rows: dims.rows,
    shellState: tracker?.state ?? "unknown",
    cwd: session.cwd,
  });
});

// ---------------------------------------------------------------------------
// POST /api/agent/sessions/:id/exec — execute command, wait for completion
// ---------------------------------------------------------------------------
router.post("/api/agent/sessions/:id/exec", async (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") return res.status(409).json({ error: "Not a terminal session" });

  const { command, timeout = 30000 } = req.body;
  if (typeof command !== "string" || command.length === 0 || command.length > SAFE_TEXT_LIMIT) {
    return res.status(400).json({ error: "Invalid command" });
  }

  const safeTimeout = Math.max(1000, Math.min(Number(timeout) || 30000, 300000)); // 1s to 5min

  // Ensure PTY is running
  let ptyProcess = getPty(session.id);
  const io = req.app.get("io");

  if (!ptyProcess) {
    try {
      ptyProcess = createPty(session.id, session.shell, session.cwd);
      if (io && !hasOutputListeners(session.id)) {
        const sid = session.id;
        const emitter = (chunk: string) => {
          io.to(sid).emit("terminal_output", { sessionId: sid, data: chunk });
        };
        addPtyOutputListener(sid, emitter);
      }
    } catch {
      return res.status(503).json({ error: "Failed to create terminal" });
    }
  }

  const tracker = getCommandTracker(session.id);
  const headless = getHeadless(session.id);

  if (!tracker || !headless) {
    return res.status(503).json({ error: "Terminal not ready" });
  }

  // Send the command + newline
  const commandWithNewline = command.endsWith("\n") ? command : `${command}\n`;

  // Collect output after command start
  const outputChunks: string[] = [];
  let commandDone = false;
  let result: any = null;

  const cleanup = onCommandLifecycle((event, sessionId, data) => {
    if (sessionId !== session.id) return;
    if (event === "command_end") {
      commandDone = true;
      result = {
        command: data.command || command,
        exitCode: data.exitCode ?? null,
        output: data.output || outputChunks.join(""),
        durationMs: data.durationMs ?? null,
        cwd: session.cwd,
        timedOut: false,
      };
    }
  });

  // Also capture raw output for the response
  const outputCleanup = addPtyOutputListener(session.id, (chunk: string) => {
    outputChunks.push(chunk);
  });

  // Write the command
  try {
    ptyProcess.write(commandWithNewline);
    tracker.inputSent(commandWithNewline);
  } catch {
    cleanup();
    outputCleanup?.();
    return res.status(503).json({ error: "Failed to write command" });
  }

  // Wait for completion or timeout
  const startTime = Date.now();
  await new Promise<void>((resolve) => {
    const checkInterval = setInterval(() => {
      if (commandDone || Date.now() - startTime >= safeTimeout) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 50);
  });

  cleanup();
  outputCleanup?.();

  if (commandDone && result) {
    return res.json(result);
  }

  // Timed out — return what we have
  const { stripAnsi } = await import("../types.js");
  res.json({
    command,
    exitCode: null,
    output: stripAnsi(outputChunks.join("")),
    durationMs: Date.now() - startTime,
    cwd: session.cwd,
    timedOut: true,
  });
});

// ---------------------------------------------------------------------------
// POST /api/agent/sessions/:id/input — send raw input (for interactive programs)
// ---------------------------------------------------------------------------
router.post("/api/agent/sessions/:id/input", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") return res.status(409).json({ error: "Not a terminal session" });

  const { data } = req.body;
  if (typeof data !== "string" || data.length > SAFE_TEXT_LIMIT) {
    return res.status(400).json({ error: "Invalid input" });
  }

  let ptyProcess = getPty(session.id);
  const io = req.app.get("io");

  if (!ptyProcess) {
    try {
      ptyProcess = createPty(session.id, session.shell, session.cwd);
      if (io && !hasOutputListeners(session.id)) {
        const sid = session.id;
        const emitter = (chunk: string) => {
          io.to(sid).emit("terminal_output", { sessionId: sid, data: chunk });
        };
        addPtyOutputListener(sid, emitter);
      }
    } catch {
      return res.status(503).json({ error: "Failed to create terminal" });
    }
  }

  try {
    ptyProcess.write(data);
    getCommandTracker(session.id)?.inputSent(data);
    res.json({ accepted: true });
  } catch {
    res.status(503).json({ error: "Failed to write input" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/agent/sessions/:id/wait-idle — long-poll until shell is idle
// ---------------------------------------------------------------------------
router.get("/api/agent/sessions/:id/wait-idle", async (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") return res.status(409).json({ error: "Not a terminal session" });

  const timeout = Math.max(1000, Math.min(Number(req.query.timeout) || 30000, 300000));
  const tracker = getCommandTracker(session.id);

  if (!tracker) {
    return res.status(503).json({ error: "Terminal not attached" });
  }

  // Already idle?
  if (tracker.state === "idle") {
    return res.json({ state: "idle", waited: 0 });
  }

  const startTime = Date.now();
  let resolved = false;

  const onIdle = () => {
    if (resolved) return;
    resolved = true;
    tracker.removeListener("idle", onIdle);
    res.json({ state: "idle", waited: Date.now() - startTime });
  };

  tracker.on("idle", onIdle);

  // Timeout fallback
  setTimeout(() => {
    if (resolved) return;
    resolved = true;
    tracker.removeListener("idle", onIdle);
    res.json({ state: tracker.state, waited: Date.now() - startTime, timedOut: true });
  }, timeout);
});

// ---------------------------------------------------------------------------
// GET /api/agent/sessions/:id/observe — SSE stream of terminal events
// ---------------------------------------------------------------------------
router.get("/api/agent/sessions/:id/observe", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") return res.status(409).json({ error: "Not a terminal session" });

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  res.write(":\n\n"); // SSE comment as keepalive

  let closed = false;

  // Stream command lifecycle events
  const cleanup = onCommandLifecycle((event, sessionId, data) => {
    if (closed || sessionId !== session.id) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  });

  // Stream screen updates (throttled to avoid overwhelming clients)
  let lastScreenSent = 0;
  const outputCleanup = addPtyOutputListener(session.id, () => {
    if (closed) return;
    const now = Date.now();
    if (now - lastScreenSent < 200) return; // Max 5 updates/sec
    lastScreenSent = now;

    const headless = getHeadless(session.id);
    if (!headless) return;
    const cursor = headless.getCursor();
    res.write(`event: screen\ndata: ${JSON.stringify({
      lines: headless.getScreenLines(),
      cursorX: cursor.x,
      cursorY: cursor.y,
    })}\n\n`);
  });

  // Keepalive every 15s
  const keepalive = setInterval(() => {
    if (closed) return;
    res.write(":\n\n");
  }, 15000);

  req.on("close", () => {
    closed = true;
    cleanup();
    outputCleanup?.();
    clearInterval(keepalive);
  });
});

export default router;
