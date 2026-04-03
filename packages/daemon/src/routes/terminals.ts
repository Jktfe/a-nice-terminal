import { Router } from "express";

// TerminalBackend interface — implementation lives in terminal-orchestrator (built in parallel).
// Defined inline here so this file compiles independently.
interface TerminalBackend {
  isAvailable(): Promise<boolean>;
  create(opts: { sessionId: string; cwd?: string; command?: string; title?: string }): Promise<{ id: string }>;
  input(sessionId: string, text: string): Promise<void>;
  sendKey(sessionId: string, key: string): Promise<void>;
  exec(sessionId: string, command: string, timeoutMs?: number): Promise<{ exitCode: number }>;
  focus(sessionId: string): Promise<void>;
  close(sessionId: string): Promise<void>;
  list(): Promise<Array<{ id: string; title?: string; cwd?: string }>>;
}

import { getTerminalBackend } from "../terminal-orchestrator/index.js";

const router = Router();

// Helper: resolve the backend and handle the common "not installed" case.
async function resolveBackend(): Promise<{ backend: TerminalBackend } | { error: string; status: number }> {
  const backend = getTerminalBackend() as TerminalBackend;
  const available = await backend.isAvailable();
  if (!available) {
    return { error: "Ghostty not installed", status: 503 };
  }
  return { backend };
}

// GET /api/terminals/available — must be declared before /:id routes
router.get("/api/terminals/available", async (_req, res) => {
  try {
    const backend = getTerminalBackend() as TerminalBackend;
    const available = await backend.isAvailable();
    res.json({ available });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Internal error" });
  }
});

// GET /api/terminals — list all known terminals
router.get("/api/terminals", async (_req, res) => {
  try {
    const result = await resolveBackend();
    if ("error" in result) return res.status(result.status).json({ error: result.error });

    const terminals = await result.backend.list();
    res.json(terminals);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Internal error" });
  }
});

// POST /api/terminals — create a new terminal
router.post("/api/terminals", async (req, res) => {
  try {
    const result = await resolveBackend();
    if ("error" in result) return res.status(result.status).json({ error: result.error });

    const { sessionId, cwd, command, title } = req.body as {
      sessionId: string;
      cwd?: string;
      command?: string;
      title?: string;
    };

    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const created = await result.backend.create({ sessionId, cwd, command, title });
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Internal error" });
  }
});

// POST /api/terminals/:id/input — send text input
router.post("/api/terminals/:id/input", async (req, res) => {
  try {
    const result = await resolveBackend();
    if ("error" in result) return res.status(result.status).json({ error: result.error });

    const { text } = req.body as { text: string };
    if (typeof text !== "string") {
      return res.status(400).json({ error: "text must be a string" });
    }

    await result.backend.input(req.params.id, text);
    res.json({ accepted: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Internal error" });
  }
});

// POST /api/terminals/:id/key — send a key sequence
router.post("/api/terminals/:id/key", async (req, res) => {
  try {
    const result = await resolveBackend();
    if ("error" in result) return res.status(result.status).json({ error: result.error });

    const { key } = req.body as { key: string };
    if (typeof key !== "string") {
      return res.status(400).json({ error: "key must be a string" });
    }

    await result.backend.sendKey(req.params.id, key);
    res.json({ accepted: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Internal error" });
  }
});

// POST /api/terminals/:id/exec — run a command and wait for exit
router.post("/api/terminals/:id/exec", async (req, res) => {
  try {
    const result = await resolveBackend();
    if ("error" in result) return res.status(result.status).json({ error: result.error });

    const { command, timeoutMs } = req.body as { command: string; timeoutMs?: number };
    if (typeof command !== "string" || !command.trim()) {
      return res.status(400).json({ error: "command must be a non-empty string" });
    }

    const execResult = await result.backend.exec(req.params.id, command, timeoutMs);
    res.json(execResult);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Internal error" });
  }
});

// POST /api/terminals/:id/focus — bring terminal to front
router.post("/api/terminals/:id/focus", async (req, res) => {
  try {
    const result = await resolveBackend();
    if ("error" in result) return res.status(result.status).json({ error: result.error });

    await result.backend.focus(req.params.id);
    res.json({ focused: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Internal error" });
  }
});

// DELETE /api/terminals/:id — close a terminal
router.delete("/api/terminals/:id", async (req, res) => {
  try {
    const result = await resolveBackend();
    if ("error" in result) return res.status(result.status).json({ error: result.error });

    await result.backend.close(req.params.id);
    res.json({ closed: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Internal error" });
  }
});

export default router;
