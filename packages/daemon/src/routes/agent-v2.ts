/**
 * Agent V2 API — multi-format terminal state for any AI model.
 *
 * Adds structured command/output pairs, summary format, and seq IDs
 * to give every model (Claude, Gemini, Codex, DeepSeek, local) the
 * terminal representation that works best for its context window.
 *
 * All endpoints live under /api/v2/ and complement (not replace) the
 * existing /api/agent/ routes.
 */
import { Router } from "express";
import { nanoid } from "nanoid";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import db from "../db.js";
import type { DbSession } from "../types.js";
import { stripAnsi } from "../types.js";
import { features } from "../feature-flags.js";
import {
  getHeadless,
  getCommandTracker,
  getTerminalOutput,
  getTerminalOutputCursor,
  hasSession,
} from "../pty-manager.js";
import { registerDiscoveredModels } from "../agent/auto-discover.js";

const router = Router();

// ---------------------------------------------------------------------------
// Tier → TTL mapping
// ---------------------------------------------------------------------------

const TIER_TTL: Record<string, number | null> = {
  sprint: 15,       // 15 minutes
  session: 105,     // 1h 45m
  persistent: 0,    // always on (0 = no kill timer)
};

function tierToTtlMinutes(tier: string): number | null {
  return TIER_TTL[tier] ?? 105;
}

// ---------------------------------------------------------------------------
// Danger check helper
// ---------------------------------------------------------------------------

interface DangerousCommand {
  id: number;
  pattern: string;
  severity: string;
  message: string;
}

function checkDangerousCommand(command: string): DangerousCommand | null {
  const patterns = db.prepare("SELECT * FROM dangerous_commands").all() as DangerousCommand[];
  const lowerCmd = command.toLowerCase();
  for (const p of patterns) {
    if (lowerCmd.includes(p.pattern.toLowerCase())) {
      return p;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lock expiry check helper
// ---------------------------------------------------------------------------

const LOCK_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

function cleanExpiredLocks(): void {
  db.prepare("DELETE FROM terminal_locks WHERE expires_at < datetime('now')").run();
}

function getActiveLock(sessionId: string): { session_id: string; holder_agent: string; acquired_at: string; expires_at: string } | undefined {
  cleanExpiredLocks();
  return db.prepare("SELECT * FROM terminal_locks WHERE session_id = ?").get(sessionId) as any;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DbCommandEvent {
  id: string;
  session_id: string;
  command: string;
  exit_code: number | null;
  output: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  cwd: string | null;
  detection_method: string;
}

type OutputFormat = "raw" | "structured" | "summary";

function parseFormat(format: unknown): OutputFormat {
  if (format === "structured" || format === "summary" || format === "raw") {
    return format;
  }
  return "raw";
}

// ---------------------------------------------------------------------------
// GET /api/v2/sessions/:id/terminal/state — format-negotiated terminal state
// ---------------------------------------------------------------------------
router.get("/api/v2/sessions/:id/terminal/state", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") return res.status(409).json({ error: "Not a terminal session" });

  const format = parseFormat(req.query.format);
  const seq = getTerminalOutputCursor(session.id);

  if (format === "summary") {
    return res.json(buildSummary(session, seq));
  }

  if (format === "structured") {
    return res.json(buildStructured(session, seq));
  }

  // Default: raw screen state (same as existing /api/agent/sessions/:id/screen but with seq)
  const headless = getHeadless(session.id);
  if (!headless) {
    return res.status(503).json({
      error: "Terminal not attached",
      seq,
    });
  }

  const tracker = getCommandTracker(session.id);
  const cursor = headless.getCursor();
  const dims = headless.getDimensions();

  res.json({
    format: "raw",
    seq,
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
// GET /api/v2/sessions/:id/terminal/structured — command/output pairs
// ---------------------------------------------------------------------------
router.get("/api/v2/sessions/:id/terminal/structured", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") return res.status(409).json({ error: "Not a terminal session" });

  const seq = getTerminalOutputCursor(session.id);
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
  const since = req.query.since as string | undefined;

  res.json(buildStructured(session, seq, { limit, since }));
});

// ---------------------------------------------------------------------------
// GET /api/v2/sessions/:id/terminal/summary — compact text for small models
// ---------------------------------------------------------------------------
router.get("/api/v2/sessions/:id/terminal/summary", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") return res.status(409).json({ error: "Not a terminal session" });

  const seq = getTerminalOutputCursor(session.id);
  res.json(buildSummary(session, seq));
});

// ---------------------------------------------------------------------------
// GET /api/v2/sessions/:id/terminal/output — paginated output with seq
// ---------------------------------------------------------------------------
router.get("/api/v2/sessions/:id/terminal/output", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") return res.status(409).json({ error: "Not a terminal session" });

  const since = parseInt(req.query.since as string) || 0;
  const limit = parseInt(req.query.limit as string) || 200;
  const format = parseFormat(req.query.format);

  const chunks = getTerminalOutput(session.id, { since, limit });
  const currentSeq = getTerminalOutputCursor(session.id);

  if (format === "structured") {
    return res.json(buildStructured(session, currentSeq, { limit: 20 }));
  }

  if (format === "summary") {
    return res.json(buildSummary(session, currentSeq));
  }

  res.json({
    format: "raw",
    seq: currentSeq,
    chunks: chunks.map((c: any) => ({
      seq: c.index,
      data: c.data,
      created_at: c.created_at,
    })),
  });
});

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildStructured(
  session: DbSession,
  seq: number,
  options?: { limit?: number; since?: string },
) {
  const limit = options?.limit ?? 20;
  const tracker = getCommandTracker(session.id);

  let query = `
    SELECT * FROM command_events
    WHERE session_id = ?
  `;
  const params: any[] = [session.id];

  if (options?.since) {
    query += ` AND started_at >= ?`;
    params.push(options.since);
  }

  query += ` ORDER BY started_at DESC LIMIT ?`;
  params.push(limit);

  const events = db.prepare(query).all(...params) as DbCommandEvent[];

  // Reverse to chronological order
  events.reverse();

  return {
    format: "structured",
    seq,
    shellState: tracker?.state ?? (hasSession(session.id) ? "unknown" : "dead"),
    cwd: session.cwd,
    commands: events.map((e) => ({
      id: e.id,
      command: e.command,
      exit_code: e.exit_code,
      output: e.output ? stripAnsi(e.output).slice(0, 10000) : null,
      started_at: e.started_at,
      completed_at: e.completed_at,
      duration_ms: e.duration_ms,
      cwd: e.cwd,
      detection_method: e.detection_method,
    })),
  };
}

function buildSummary(session: DbSession, seq: number) {
  const tracker = getCommandTracker(session.id);
  const shellState = tracker?.state ?? (hasSession(session.id) ? "unknown" : "dead");

  // Get last command
  const lastCmd = db.prepare(
    "SELECT * FROM command_events WHERE session_id = ? ORDER BY started_at DESC LIMIT 1"
  ).get(session.id) as DbCommandEvent | undefined;

  let summary: string;

  if (!lastCmd) {
    summary = `Terminal ${shellState} in ${session.cwd || "unknown"}. No commands recorded.`;
  } else {
    const exitInfo = lastCmd.exit_code === 0
      ? "succeeded"
      : lastCmd.exit_code !== null
        ? `failed (exit ${lastCmd.exit_code})`
        : "running";
    const duration = lastCmd.duration_ms ? ` in ${Math.round(lastCmd.duration_ms / 1000)}s` : "";
    summary = `Terminal ${shellState} in ${session.cwd || "unknown"}. Last: \`${lastCmd.command}\` ${exitInfo}${duration}.`;
  }

  // Count recent errors (last 10 commands)
  const recentErrors = db.prepare(
    "SELECT COUNT(*) as count FROM (SELECT exit_code FROM command_events WHERE session_id = ? ORDER BY started_at DESC LIMIT 10) WHERE exit_code != 0 AND exit_code IS NOT NULL"
  ).get(session.id) as { count: number } | undefined;

  const actionSuggestions: string[] = [];
  if (shellState === "dead") {
    actionSuggestions.push("Join session to re-attach terminal");
  }
  if (lastCmd?.exit_code && lastCmd.exit_code !== 0) {
    actionSuggestions.push("Check error output with format=structured");
    actionSuggestions.push("Search knowledge for similar errors");
  }
  if (recentErrors && recentErrors.count > 3) {
    actionSuggestions.push("Multiple recent failures — consider reviewing approach");
  }

  return {
    format: "summary",
    seq,
    summary,
    shellState,
    cwd: session.cwd,
    lastCommand: lastCmd ? {
      command: lastCmd.command,
      exit_code: lastCmd.exit_code,
      duration_ms: lastCmd.duration_ms,
    } : null,
    recentErrorCount: recentErrors?.count ?? 0,
    actionSuggestions,
  };
}

// ---------------------------------------------------------------------------
// OpenAI Function-Calling Gateway
// ---------------------------------------------------------------------------

interface FunctionCall {
  name: string;
  arguments: Record<string, any>;
}

const TOOL_ROUTES: Record<string, (args: Record<string, any>, req: any) => Promise<any>> = {
  list_sessions: async (args) => {
    return db.prepare(`SELECT * FROM sessions WHERE ${args.include_archived ? '1=1' : 'archived = 0'} ORDER BY updated_at DESC`).all();
  },
  get_session: async (args) => {
    return db.prepare("SELECT * FROM sessions WHERE id = ?").get(args.session_id);
  },
  get_dashboard: async () => {
    return db.prepare("SELECT id, name, type, cwd, archived, tier, ttl_minutes, created_at, updated_at FROM sessions WHERE archived = 0 ORDER BY updated_at DESC").all();
  },
  get_terminal_state: async (args) => {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(args.session_id) as DbSession | undefined;
    if (!session) return { error: "Session not found" };
    const format = args.format || "structured";
    const seq = getTerminalOutputCursor(session.id);
    if (format === "summary") return buildSummary(session, seq);
    if (format === "structured") return buildStructured(session, seq);
    const headless = getHeadless(session.id);
    if (!headless) return { error: "Terminal not attached", seq };
    const cursor = headless.getCursor();
    return { format: "raw", seq, lines: headless.getScreenLines(), cursorX: cursor.x, cursorY: cursor.y };
  },
  get_command_history: async (args) => {
    const limit = Math.min(args.limit || 20, 100);
    return db.prepare("SELECT * FROM command_events WHERE session_id = ? ORDER BY started_at DESC LIMIT ?")
      .all(args.session_id, limit);
  },
  search_knowledge: async (args) => {
    const q = args.query || "";
    const likePattern = `%${q}%`;
    return db.prepare("SELECT * FROM knowledge_facts WHERE key LIKE ? OR value LIKE ? ORDER BY confidence DESC LIMIT 20")
      .all(likePattern, likePattern);
  },
  check_error: async (args) => {
    const patterns = db.prepare("SELECT * FROM error_patterns ORDER BY success_count DESC LIMIT 200").all() as any[];
    const text = (args.error_text || "").toLowerCase();
    return patterns.filter((p: any) => text.includes(p.error_signature.toLowerCase())).slice(0, 10);
  },
  check_lock: async (args) => {
    const lock = getActiveLock(args.session_id);
    return lock ? { locked: true, holder: lock.holder_agent, expires_at: lock.expires_at } : { locked: false };
  },
  list_recipes: async (args) => {
    const limit = Math.min(args.limit || 20, 100);
    return db.prepare("SELECT id, name, description, category, approved_by, use_count FROM recipes ORDER BY use_count DESC LIMIT ?").all(limit);
  },
  list_agents: async () => {
    return db.prepare("SELECT id, model_family, display_name, capabilities, status, last_seen FROM agent_registry ORDER BY last_seen DESC").all();
  },
};

router.post("/api/v2/agent/call", async (req, res) => {
  const { agent_id, calls } = req.body;

  if (!Array.isArray(calls) || calls.length === 0) {
    return res.status(400).json({ error: "calls array is required" });
  }

  if (agent_id) {
    db.prepare("UPDATE agent_registry SET status = 'online', last_seen = datetime('now') WHERE id = ?").run(agent_id);
  }

  const results: Array<{ name: string; result: any; error?: string }> = [];

  for (const call of calls as FunctionCall[]) {
    const handler = TOOL_ROUTES[call.name];
    if (!handler) {
      results.push({ name: call.name, result: null, error: `Unknown tool: ${call.name}` });
      continue;
    }
    try {
      const result = await handler(call.arguments || {}, req);
      results.push({ name: call.name, result });
    } catch (err: any) {
      results.push({ name: call.name, result: null, error: err.message || "Tool execution failed" });
    }
  }

  res.json({ agent_id, results, available_tools: Object.keys(TOOL_ROUTES) });
});

router.get("/api/v2/agent/tools", (_req, res) => {
  res.json({
    tools: Object.keys(TOOL_ROUTES).map((name) => ({ name, type: "function" })),
    hint: "Call POST /api/v2/agent/call with { agent_id, calls: [{ name, arguments }] }",
  });
});

// ---------------------------------------------------------------------------
// Session Dashboard
// ---------------------------------------------------------------------------

router.get("/api/v2/sessions/dashboard", (_req, res) => {
  const sessions = db.prepare(
    "SELECT * FROM sessions WHERE archived = 0 ORDER BY updated_at DESC"
  ).all() as DbSession[];

  const result = sessions.map((s) => {
    const tracker = getCommandTracker(s.id);
    const isAlive = hasSession(s.id);

    let status: string;
    if ((s as any).archived) {
      status = "archived";
    } else if (!isAlive && s.type === "terminal") {
      status = "dead";
    } else if (tracker?.state === "running") {
      status = "running";
    } else if (isAlive) {
      status = "active";
    } else {
      status = "idle";
    }

    const lastOutput = db.prepare(
      "SELECT created_at FROM terminal_output_events WHERE session_id = ? ORDER BY chunk_index DESC LIMIT 1"
    ).get(s.id) as { created_at: string } | undefined;

    const lastMessage = db.prepare(
      "SELECT created_at, content, message_type FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(s.id) as { created_at: string; content: string; message_type: string } | undefined;

    const lastActivity = [lastOutput?.created_at, lastMessage?.created_at, s.updated_at]
      .filter(Boolean)
      .sort()
      .reverse()[0] || s.updated_at;

    let preview = "";
    if (lastMessage) {
      preview = lastMessage.content.split("\n")[0].slice(0, 120);
    }

    const terminals = s.type === "unified"
      ? (db.prepare("SELECT terminal_session_id FROM session_terminals WHERE session_id = ? AND status = 'active'").all(s.id) as { terminal_session_id: string }[])
        .map((t) => t.terminal_session_id)
      : [];

    return {
      id: s.id,
      name: s.name,
      type: s.type,
      status,
      tier: (s as any).tier || "session",
      ttl_minutes: s.ttl_minutes,
      cwd: s.cwd,
      last_activity: lastActivity,
      preview,
      shell_state: tracker?.state ?? (isAlive ? "unknown" : "dead"),
      terminals,
      created_at: s.created_at,
    };
  });

  res.json(result);
});

// ---------------------------------------------------------------------------
// Session Tiers — promote / demote
// ---------------------------------------------------------------------------

router.post("/api/v2/sessions/:id/promote", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });

  const currentTier = (session as any).tier || "session";
  const tiers = ["sprint", "session", "persistent"];
  const idx = tiers.indexOf(currentTier);

  if (idx >= tiers.length - 1) {
    return res.status(409).json({ error: "Already at highest tier", tier: currentTier });
  }

  const newTier = tiers[idx + 1];
  const ttl = tierToTtlMinutes(newTier);

  db.prepare("UPDATE sessions SET tier = ?, ttl_minutes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newTier, ttl, session.id);

  res.json({ id: session.id, previous_tier: currentTier, tier: newTier, ttl_minutes: ttl });
});

router.post("/api/v2/sessions/:id/demote", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });

  const currentTier = (session as any).tier || "session";
  const tiers = ["sprint", "session", "persistent"];
  const idx = tiers.indexOf(currentTier);

  if (idx <= 0) {
    return res.status(409).json({ error: "Already at lowest tier", tier: currentTier });
  }

  const newTier = tiers[idx - 1];
  const ttl = tierToTtlMinutes(newTier);

  db.prepare("UPDATE sessions SET tier = ?, ttl_minutes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newTier, ttl, session.id);

  res.json({ id: session.id, previous_tier: currentTier, tier: newTier, ttl_minutes: ttl });
});

router.patch("/api/v2/sessions/:id/tier", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });

  const { tier } = req.body;
  if (!tier || !["sprint", "session", "persistent"].includes(tier)) {
    return res.status(400).json({ error: "tier must be 'sprint', 'session', or 'persistent'" });
  }

  const ttl = tierToTtlMinutes(tier);
  db.prepare("UPDATE sessions SET tier = ?, ttl_minutes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(tier, ttl, session.id);

  res.json({ id: session.id, tier, ttl_minutes: ttl });
});

// ---------------------------------------------------------------------------
// Danger-checked exec
// ---------------------------------------------------------------------------

router.post("/api/v2/sessions/:id/exec", async (req, res) => {
  const { command, acknowledge_danger, intent } = req.body;

  if (intent && typeof intent === "string") {
    const intentMap = (req.app.get("_intentMap") || new Map()) as Map<string, string>;
    intentMap.set(`${req.params.id}:${command}`, intent);
    req.app.set("_intentMap", intentMap);
  }

  if (typeof command !== "string" || command.length === 0) {
    return res.status(400).json({ error: "command is required" });
  }

  if (!acknowledge_danger && features.dangerChecks()) {
    const danger = checkDangerousCommand(command);
    if (danger) {
      return res.json({
        warning: true,
        pattern: danger.pattern,
        severity: danger.severity,
        message: danger.message,
        command,
        proceed: false,
        hint: "Set acknowledge_danger: true to execute anyway",
      });
    }
  }

  const agentExecUrl = `${req.protocol}://${req.get("host")}/api/agent/sessions/${req.params.id}/exec`;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (apiKey) headers["X-API-Key"] = apiKey;

    const response = await fetch(agentExecUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ command, timeout: req.body.timeout, agent_id: req.body.agent_id }),
    });

    const result = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(result);
    }
    res.json(result);
  } catch (error) {
    res.status(503).json({ error: "Failed to forward to exec endpoint" });
  }
});

// ---------------------------------------------------------------------------
// Danger pattern management
// ---------------------------------------------------------------------------

router.get("/api/v2/dangerous-commands", (_req, res) => {
  const patterns = db.prepare("SELECT * FROM dangerous_commands ORDER BY severity DESC, pattern ASC").all();
  res.json(patterns);
});

router.post("/api/v2/dangerous-commands", (req, res) => {
  const { pattern, severity, message } = req.body;
  if (!pattern || !message) return res.status(400).json({ error: "pattern and message required" });
  const sev = severity === "critical" ? "critical" : "warning";

  const result = db.prepare("INSERT INTO dangerous_commands (pattern, severity, message) VALUES (?, ?, ?)").run(pattern, sev, message);
  res.json({ id: result.lastInsertRowid, pattern, severity: sev, message });
});

// ---------------------------------------------------------------------------
// Agent Registry
// ---------------------------------------------------------------------------

router.post("/api/v2/agents/register", (req, res) => {
  const { id, handle, model_family, display_name, capabilities, preferred_formats, context_window, transport, gateway, underlying_model, api_base, config } = req.body;

  if (!id || !model_family || !display_name) {
    return res.status(400).json({ error: "id, model_family, and display_name are required" });
  }

  if (handle !== undefined && handle !== null) {
    if (typeof handle !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9-]{1,31}$/.test(handle)) {
      return res.status(400).json({ error: "handle must be 2-32 characters, alphanumeric/hyphens, starting with a letter or digit" });
    }
    const conflict = db.prepare("SELECT id FROM agent_registry WHERE handle = ? COLLATE NOCASE AND id != ?").get(handle, id) as { id: string } | undefined;
    if (conflict) {
      return res.status(409).json({ error: `Handle @${handle} is already taken by agent ${conflict.id}` });
    }
  }

  const existing = db.prepare("SELECT id FROM agent_registry WHERE id = ?").get(id);

  if (existing) {
    db.prepare(`
      UPDATE agent_registry SET
        handle = COALESCE(?, handle), model_family = ?, display_name = ?, capabilities = ?, preferred_formats = ?,
        context_window = ?, transport = ?, status = 'online', last_seen = datetime('now'),
        config = ?, gateway = ?, underlying_model = ?, api_base = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      handle ?? null,
      model_family, display_name,
      JSON.stringify(capabilities || []),
      JSON.stringify(preferred_formats || ["raw"]),
      context_window || null,
      transport || "rest",
      config ? JSON.stringify(config) : null,
      gateway || null,
      underlying_model || null,
      api_base || null,
      id,
    );
  } else {
    db.prepare(`
      INSERT INTO agent_registry (id, handle, model_family, display_name, capabilities, preferred_formats, context_window, transport, status, last_seen, config, gateway, underlying_model, api_base)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'online', datetime('now'), ?, ?, ?, ?)
    `).run(
      id, handle || null, model_family, display_name,
      JSON.stringify(capabilities || []),
      JSON.stringify(preferred_formats || ["raw"]),
      context_window || null,
      transport || "rest",
      config ? JSON.stringify(config) : null,
      gateway || null,
      underlying_model || null,
      api_base || null,
    );
  }

  const agent = db.prepare("SELECT * FROM agent_registry WHERE id = ?").get(id);
  res.json(agent);
});

router.get("/api/v2/agents", (_req, res) => {
  const agents = db.prepare("SELECT * FROM agent_registry ORDER BY last_seen DESC").all();
  res.json(agents);
});

router.get("/api/v2/agents/:id", (req, res) => {
  const agent = db.prepare("SELECT * FROM agent_registry WHERE id = ?").get(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json(agent);
});

router.delete("/api/v2/agents/:id", (req, res) => {
  const result = db.prepare("DELETE FROM agent_registry WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Agent not found" });
  db.prepare("DELETE FROM terminal_locks WHERE holder_agent = ?").run(req.params.id);
  res.json({ deleted: true, id: req.params.id });
});

router.post("/api/v2/agents/:id/heartbeat", (req, res) => {
  const result = db.prepare(
    "UPDATE agent_registry SET status = 'online', last_seen = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Agent not found" });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Conversation Membership
// ---------------------------------------------------------------------------

router.post("/api/v2/conversations/:id/join", (req, res) => {
  const sessionId = req.params.id;
  const { agent_id, handle: overrideHandle, role } = req.body;

  if (!agent_id) return res.status(400).json({ error: "agent_id is required" });

  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "conversation" && session.type !== "unified") {
    return res.status(409).json({ error: "Can only join conversation or unified sessions" });
  }

  const agent = db.prepare("SELECT * FROM agent_registry WHERE id = ?").get(agent_id) as any;
  if (!agent) return res.status(404).json({ error: "Agent not found — register first via POST /api/v2/agents/register" });

  const memberHandle = overrideHandle || agent.handle || agent.display_name;
  if (!memberHandle) {
    return res.status(400).json({ error: "No handle available — provide handle in request or register with a handle first" });
  }

  const conflict = db.prepare(
    "SELECT agent_id FROM conversation_members WHERE session_id = ? AND LOWER(handle) = LOWER(?) AND agent_id != ?"
  ).get(sessionId, memberHandle, agent_id) as { agent_id: string } | undefined;
  if (conflict) {
    return res.status(409).json({ error: `Handle @${memberHandle} is already in use in this conversation by agent ${conflict.agent_id}` });
  }

  const memberRole = role === "observer" ? "observer" : "participant";

  db.prepare(`
    INSERT INTO conversation_members (session_id, agent_id, handle, role)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id, agent_id) DO UPDATE SET handle = ?, role = ?, joined_at = datetime('now')
  `).run(sessionId, agent_id, memberHandle, memberRole, memberHandle, memberRole);

  const msgId = nanoid(12);
  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, format, sender_type, sender_name, message_type)
    VALUES (?, ?, 'system', ?, 'text', 'system', 'ANT', 'text')
  `).run(msgId, sessionId, `@${memberHandle} has joined the conversation`);

  const io = req.app.get("io");
  if (io) {
    io.to(sessionId).emit("member_joined", { session_id: sessionId, agent_id, handle: memberHandle, role: memberRole });
    const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(msgId);
    if (msg) io.to(sessionId).emit("message_created", msg);
  }

  res.json({ joined: true, session_id: sessionId, agent_id, handle: memberHandle, role: memberRole });
});

router.delete("/api/v2/conversations/:id/leave", (req, res) => {
  const sessionId = req.params.id;
  const { agent_id } = req.body;

  if (!agent_id) return res.status(400).json({ error: "agent_id is required" });

  const member = db.prepare("SELECT handle FROM conversation_members WHERE session_id = ? AND agent_id = ?").get(sessionId, agent_id) as { handle: string } | undefined;
  if (!member) return res.status(404).json({ error: "Agent is not a member of this conversation" });

  db.prepare("DELETE FROM conversation_members WHERE session_id = ? AND agent_id = ?").run(sessionId, agent_id);

  const msgId = nanoid(12);
  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, format, sender_type, sender_name, message_type)
    VALUES (?, ?, 'system', ?, 'text', 'system', 'ANT', 'text')
  `).run(msgId, sessionId, `@${member.handle} has left the conversation`);

  const io = req.app.get("io");
  if (io) {
    io.to(sessionId).emit("member_left", { session_id: sessionId, agent_id, handle: member.handle });
    const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(msgId);
    if (msg) io.to(sessionId).emit("message_created", msg);
  }

  res.json({ left: true, session_id: sessionId, agent_id, handle: member.handle });
});

router.get("/api/v2/conversations/:id/members", (req, res) => {
  const sessionId = req.params.id;
  const members = db.prepare(`
    SELECT cm.agent_id, cm.handle, cm.role, cm.joined_at,
           ar.display_name, ar.model_family, ar.capabilities, ar.status, ar.last_seen
    FROM conversation_members cm
    JOIN agent_registry ar ON ar.id = cm.agent_id
    WHERE cm.session_id = ?
    ORDER BY cm.joined_at ASC
  `).all(sessionId);
  res.json(members);
});

router.get("/api/v2/agent/:id/conversations", (req, res) => {
  const agentId = req.params.id;
  const conversations = db.prepare(`
    SELECT cm.session_id, cm.handle, cm.role, cm.joined_at,
           s.name, s.type, s.updated_at
    FROM conversation_members cm
    JOIN sessions s ON s.id = cm.session_id
    WHERE cm.agent_id = ? AND s.archived = 0
    ORDER BY s.updated_at DESC
  `).all(agentId);
  res.json(conversations);
});

router.post("/api/v2/agents/discover", async (_req, res) => {
  try {
    const result = await registerDiscoveredModels();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "Discovery failed", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Beeper token endpoint
// ---------------------------------------------------------------------------

router.get("/api/v2/beeper/token", (_req, res) => {
  const tokenRow = db.prepare("SELECT value FROM server_state WHERE key = 'beeper_access_token'").get() as { value: string } | undefined;
  if (!tokenRow) return res.status(404).json({ error: "Beeper not authenticated" });
  res.json({ token: tokenRow.value });
});

// ---------------------------------------------------------------------------
// Terminal Screenshot (SVG)
// ---------------------------------------------------------------------------

router.get("/api/v2/sessions/:id/terminal/screenshot", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal" && session.type !== "unified") {
    return res.status(409).json({ error: "Not a terminal session" });
  }

  let terminalId = session.id;
  if (session.type === "unified") {
    const link = db.prepare("SELECT terminal_session_id FROM session_terminals WHERE session_id = ? AND status = 'active' LIMIT 1")
      .get(session.id) as { terminal_session_id: string } | undefined;
    if (!link) return res.status(404).json({ error: "No active terminal linked to this unified session" });
    terminalId = link.terminal_session_id;
  }

  const headless = getHeadless(terminalId);
  if (!headless) return res.status(503).json({ error: "Terminal not attached" });

  const lines = headless.getScreenLines();
  const dims = headless.getDimensions();
  const cursor = headless.getCursor();

  const charWidth = 8.4;
  const lineHeight = 18;
  const padding = 16;
  const width = Math.ceil(dims.cols * charWidth + padding * 2);
  const height = Math.ceil(dims.rows * lineHeight + padding * 2);

  const escapeSvg = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const textLines = lines.map((line, i) => {
    const y = padding + (i + 1) * lineHeight;
    return `<text x="${padding}" y="${y}" xml:space="preserve">${escapeSvg(line)}</text>`;
  }).join("\n");

  const cursorX = padding + cursor.x * charWidth;
  const cursorY = padding + cursor.y * lineHeight + 2;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0a0a0a" rx="8"/>
  <g font-family="monospace, 'Courier New'" font-size="14" fill="#e4e4e7">
    ${textLines}
  </g>
  <rect x="${cursorX}" y="${cursorY}" width="${charWidth}" height="${lineHeight}" fill="#10b981" opacity="0.7" rx="1"/>
</svg>`;

  const format = req.query.format;
  if (format === "json") {
    return res.json({
      format: "screenshot",
      content_type: "image/svg+xml",
      data: Buffer.from(svg).toString("base64"),
      width,
      height,
      cols: dims.cols,
      rows: dims.rows,
    });
  }

  res.setHeader("Content-Type", "image/svg+xml");
  res.send(svg);
});

// ---------------------------------------------------------------------------
// Terminal Locks (Mutex)
// ---------------------------------------------------------------------------

router.post("/api/v2/sessions/:id/lock", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") return res.status(409).json({ error: "Not a terminal session" });

  const { agent_id, duration_ms } = req.body;
  if (!agent_id) return res.status(400).json({ error: "agent_id is required" });

  const existingLock = getActiveLock(session.id);

  if (existingLock && existingLock.holder_agent !== agent_id) {
    return res.status(423).json({
      error: "Terminal locked",
      holder: existingLock.holder_agent,
      acquired_at: existingLock.acquired_at,
      expires_at: existingLock.expires_at,
    });
  }

  const safeDuration = Math.min(Math.max(duration_ms || LOCK_EXPIRY_MS, 10000), 30 * 60 * 1000);
  const expiresAt = new Date(Date.now() + safeDuration).toISOString();

  db.prepare(`
    INSERT OR REPLACE INTO terminal_locks (session_id, holder_agent, acquired_at, expires_at)
    VALUES (?, ?, datetime('now'), ?)
  `).run(session.id, agent_id, expiresAt);

  res.json({ acquired: true, session_id: session.id, holder: agent_id, expires_at: expiresAt });
});

router.delete("/api/v2/sessions/:id/lock", (req, res) => {
  const { agent_id } = req.body || {};

  const lock = getActiveLock(req.params.id);
  if (!lock) return res.json({ released: true, was_locked: false });

  if (agent_id && lock.holder_agent !== agent_id) {
    return res.status(403).json({ error: "Not the lock holder", holder: lock.holder_agent });
  }

  db.prepare("DELETE FROM terminal_locks WHERE session_id = ?").run(req.params.id);
  res.json({ released: true, was_locked: true, previous_holder: lock.holder_agent });
});

router.get("/api/v2/sessions/:id/lock", (req, res) => {
  const lock = getActiveLock(req.params.id);
  if (!lock) return res.json({ locked: false });
  res.json({ locked: true, holder: lock.holder_agent, acquired_at: lock.acquired_at, expires_at: lock.expires_at });
});

// ---------------------------------------------------------------------------
// User Preferences
// ---------------------------------------------------------------------------

router.get("/api/v2/preferences", (req, res) => {
  const { domain, user_id } = req.query;
  const userId = (user_id as string) || "default";

  let query = "SELECT * FROM user_preferences WHERE user_id = ?";
  const params: any[] = [userId];

  if (domain) { query += " AND domain = ?"; params.push(domain); }
  query += " ORDER BY strength DESC";

  res.json(db.prepare(query).all(...params));
});

router.post("/api/v2/preferences", (req, res) => {
  const { domain, key, value, user_id } = req.body;
  if (!domain || !key || !value) return res.status(400).json({ error: "domain, key, and value are required" });

  const userId = user_id || "default";

  db.prepare(`
    INSERT INTO user_preferences (user_id, domain, key, value, strength, source)
    VALUES (?, ?, ?, ?, 0.9, 'explicit')
    ON CONFLICT(user_id, domain, key) DO UPDATE SET
      value = excluded.value, strength = 0.9, source = 'explicit',
      evidence_count = evidence_count + 1, updated_at = datetime('now')
  `).run(userId, domain, key, value);

  const pref = db.prepare("SELECT * FROM user_preferences WHERE user_id = ? AND domain = ? AND key = ?").get(userId, domain, key);
  res.json(pref);
});

router.post("/api/v2/preferences/learn", (_req, res) => {
  const pmCounts = db.prepare(`
    SELECT
      CASE
        WHEN command LIKE 'bun %' OR command LIKE 'bunx %' THEN 'bun'
        WHEN command LIKE 'npm %' OR command LIKE 'npx %' THEN 'npm'
        WHEN command LIKE 'pnpm %' OR command LIKE 'pnpx %' THEN 'pnpm'
        WHEN command LIKE 'yarn %' THEN 'yarn'
        ELSE NULL
      END as pm,
      COUNT(*) as count
    FROM command_events
    WHERE pm IS NOT NULL
    GROUP BY pm
    ORDER BY count DESC
  `).all() as Array<{ pm: string; count: number }>;

  const learned: string[] = [];

  if (pmCounts.length > 0) {
    const top = pmCounts[0];
    const total = pmCounts.reduce((s, p) => s + p.count, 0);
    const strength = Math.min(0.95, top.count / total);

    db.prepare(`
      INSERT INTO user_preferences (user_id, domain, key, value, strength, source, evidence_count)
      VALUES ('default', 'tooling', 'package_manager', ?, ?, 'observed', ?)
      ON CONFLICT(user_id, domain, key) DO UPDATE SET
        value = excluded.value, strength = excluded.strength, source = 'observed',
        evidence_count = excluded.evidence_count, updated_at = datetime('now')
    `).run(top.pm, strength, total);
    learned.push(`tooling:package_manager = ${top.pm} (${(strength * 100).toFixed(0)}% from ${total} commands)`);
  }

  const shellCounts = db.prepare(`
    SELECT shell, COUNT(*) as count FROM sessions WHERE shell IS NOT NULL GROUP BY shell ORDER BY count DESC
  `).all() as Array<{ shell: string; count: number }>;

  if (shellCounts.length > 0) {
    const top = shellCounts[0];
    db.prepare(`
      INSERT INTO user_preferences (user_id, domain, key, value, strength, source, evidence_count)
      VALUES ('default', 'tooling', 'shell', ?, 0.8, 'observed', ?)
      ON CONFLICT(user_id, domain, key) DO UPDATE SET
        value = excluded.value, evidence_count = excluded.evidence_count, updated_at = datetime('now')
    `).run(top.shell, top.count);
    learned.push(`tooling:shell = ${top.shell}`);
  }

  res.json({ learned });
});

// ---------------------------------------------------------------------------
// Resource Monitoring
// ---------------------------------------------------------------------------

router.get("/api/v2/sessions/:id/resources", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_commands,
      SUM(CASE WHEN exit_code != 0 AND exit_code IS NOT NULL THEN 1 ELSE 0 END) as error_count,
      AVG(duration_ms) as avg_duration_ms,
      MAX(duration_ms) as max_duration_ms
    FROM command_events WHERE session_id = ?
  `).get(session.id) as any;

  const outputSize = db.prepare(
    "SELECT COUNT(*) as chunks, SUM(LENGTH(data)) as total_bytes FROM terminal_output_events WHERE session_id = ?"
  ).get(session.id) as any;

  res.json({
    session_id: session.id,
    commands: {
      total: stats?.total_commands || 0,
      errors: stats?.error_count || 0,
      error_rate: stats?.total_commands > 0 ? (stats.error_count / stats.total_commands).toFixed(2) : "0.00",
      avg_duration_ms: Math.round(stats?.avg_duration_ms || 0),
      max_duration_ms: stats?.max_duration_ms || 0,
    },
    output: {
      chunks: outputSize?.chunks || 0,
      total_bytes: outputSize?.total_bytes || 0,
    },
    process: {
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      uptime_s: Math.round(process.uptime()),
    },
  });
});

// ---------------------------------------------------------------------------
// Agent Bootstrap — one call to productivity
// ---------------------------------------------------------------------------

router.get("/api/v2/agent/bootstrap", (req, res) => {
  const agentId = req.query.agent_id as string;
  const handle = req.query.handle as string | undefined;
  const capabilities = req.query.capabilities as string | undefined;
  const modelFamily = req.query.model_family as string | undefined;
  const displayName = req.query.display_name as string | undefined;

  if (agentId && modelFamily && displayName) {
    const existing = db.prepare("SELECT id FROM agent_registry WHERE id = ?").get(agentId);
    if (!existing) {
      const caps = capabilities ? capabilities.split(",") : [];
      db.prepare(`
        INSERT INTO agent_registry (id, handle, model_family, display_name, capabilities, status, last_seen)
        VALUES (?, ?, ?, ?, ?, 'online', datetime('now'))
      `).run(agentId, handle || null, modelFamily, displayName, JSON.stringify(caps));
    } else {
      db.prepare("UPDATE agent_registry SET status = 'online', last_seen = datetime('now') WHERE id = ?").run(agentId);
    }
  } else if (agentId) {
    db.prepare("UPDATE agent_registry SET status = 'online', last_seen = datetime('now') WHERE id = ?").run(agentId);
  }

  let you: any = null;
  if (agentId) {
    const agent = db.prepare("SELECT * FROM agent_registry WHERE id = ?").get(agentId) as any;
    const conversations = db.prepare(`
      SELECT cm.session_id, cm.handle, cm.role, cm.joined_at, s.name
      FROM conversation_members cm
      JOIN sessions s ON s.id = cm.session_id
      WHERE cm.agent_id = ? AND s.archived = 0
    `).all(agentId);

    db.prepare("UPDATE coordination_events SET status = 'expired' WHERE status = 'pending' AND expires_at < datetime('now')").run();
    const tasks = db.prepare(
      "SELECT * FROM coordination_events WHERE status = 'pending' AND target_agent_id = ? ORDER BY created_at ASC"
    ).all(agentId);

    const memberSessions = conversations.map((c: any) => c.session_id);
    let unreadMentions = 0;
    if (agent && memberSessions.length > 0) {
      const placeholders = memberSessions.map(() => "?").join(",");
      const mentionRows = db.prepare(`
        SELECT COUNT(*) as c FROM messages
        WHERE session_id IN (${placeholders})
          AND content LIKE '%@' || ? || '%'
          AND created_at > COALESCE(?, '1970-01-01')
          AND role != 'system'
      `).get(...memberSessions, agent.handle || agent.display_name, agent.last_seen || "1970-01-01") as { c: number };
      unreadMentions = mentionRows.c;
    }

    you = {
      agent_id: agentId,
      handle: agent?.handle || null,
      display_name: agent?.display_name || null,
      registered: !!agent,
      capabilities: agent ? JSON.parse(agent.capabilities) : [],
      conversations_joined: conversations,
      assigned_tasks: tasks.map((t: any) => ({
        id: t.id,
        description: JSON.parse(t.payload).task,
        source: t.source || null,
        source_message_id: t.source_message_id || null,
        session_id: t.session_id,
        created_at: t.created_at,
      })),
      unread_mentions: unreadMentions,
    };
  }

  const conversationSessions = db.prepare(`
    SELECT s.id, s.name, s.type, s.updated_at,
      (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count,
      (SELECT COUNT(*) FROM conversation_members WHERE session_id = s.id) as participant_count
    FROM sessions s
    WHERE s.type IN ('conversation', 'unified') AND s.archived = 0
    ORDER BY s.updated_at DESC LIMIT 20
  `).all() as any[];

  const myMemberships = agentId
    ? new Set(db.prepare("SELECT session_id FROM conversation_members WHERE agent_id = ?").all(agentId).map((r: any) => r.session_id))
    : new Set<string>();

  const terminalSessions = db.prepare(`
    SELECT s.id, s.name, s.shell, s.cwd, s.updated_at
    FROM sessions s
    WHERE s.type IN ('terminal', 'unified') AND s.archived = 0
    ORDER BY s.updated_at DESC LIMIT 20
  `).all() as any[];

  for (const t of terminalSessions) {
    t.idle = !hasSession(t.id) || getCommandTracker(t.id)?.state !== "running";
    const lock = getActiveLock(t.id);
    t.locked_by = lock?.holder_agent || null;
  }

  const agents = db.prepare(
    "SELECT id, handle, display_name, model_family, capabilities, status, last_seen FROM agent_registry ORDER BY last_seen DESC"
  ).all();

  const pendingTasks = db.prepare(
    "SELECT * FROM coordination_events WHERE status = 'pending' ORDER BY created_at ASC LIMIT 20"
  ).all() as any[];

  const guide = {
    quick_start: `You are an agent in ANT (Agent Orchestration Hub). Your primary loop: (1) Check your assigned_tasks and unread_mentions. (2) Claim tasks with ant_claim_task. (3) Work in terminals with ant_exec_command. (4) Post results to conversations with ant_send_message. (5) Mark done with ant_complete_task. Use ant_poll_notifications to stay updated.`,
    message_conventions: "Post to conversation sessions using ant_send_message with role='agent'. Use markdown format. For terminal output, use message_type='terminal_block'. Thread replies via thread_id. Mention other agents with @handle.",
    coordination: "Use @mentions to address specific agents by their handle. Terminal locks prevent conflicts — acquire with ant_acquire_terminal before writing. Use ant_list_agents to see who's available and their handles.",
    joining_conversations: "You only receive notifications from conversations you've joined. Use ant_join_conversation to join a chat. You can use a custom handle per conversation. Use ant_list_my_conversations to see your memberships.",
  };

  let projectContext: string | null = null;
  for (const t of terminalSessions) {
    if (t.cwd) {
      try {
        const antMdPath = path.join(t.cwd, ".ant.md");
        if (existsSync(antMdPath)) {
          projectContext = readFileSync(antMdPath, "utf-8");
          break;
        }
      } catch {}
    }
  }
  if (projectContext) (guide as any).project_context = projectContext;

  res.json({
    you,
    workspace: {
      conversations: conversationSessions.map((s: any) => ({
        ...s,
        you_are_member: myMemberships.has(s.id),
      })),
      terminals: terminalSessions,
      agents_online: agents,
    },
    pending_tasks: pendingTasks.map((t: any) => ({
      id: t.id,
      description: JSON.parse(t.payload).task,
      required_capabilities: JSON.parse(t.required_capabilities),
      target_agent_id: t.target_agent_id,
      source: t.source || null,
      session_id: t.session_id,
      created_at: t.created_at,
    })),
    guide,
    server: {
      version: "2.0",
      uptime_s: Math.round(process.uptime()),
      features_enabled: Object.entries(features).filter(([, v]) => v).map(([k]) => k),
    },
  });
});

router.get("/api/v2/agent/context", (req, res) => {
  const sessionId = req.query.session_id as string;
  const agentId = req.query.agent_id as string;
  const depth = Math.min(parseInt(req.query.depth as string) || 20, 100);

  if (!sessionId) return res.status(400).json({ error: "session_id is required" });

  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });

  const messages = db.prepare(`
    SELECT id, role, sender_name, sender_type, content, created_at, thread_id, message_type
    FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(sessionId, depth).reverse() as any[];

  for (const m of messages) {
    if (m.content && m.content.length > 300) {
      m.content_preview = m.content.slice(0, 300) + "...";
      delete m.content;
    }
  }

  const members = db.prepare(`
    SELECT cm.agent_id, cm.handle, cm.role, cm.joined_at,
           ar.display_name, ar.model_family, ar.capabilities, ar.status, ar.last_seen
    FROM conversation_members cm
    JOIN agent_registry ar ON ar.id = cm.agent_id
    WHERE cm.session_id = ?
    ORDER BY cm.joined_at ASC
  `).all(sessionId);

  const linkedTerminals = db.prepare(`
    SELECT st.terminal_session_id as id, s.name, s.cwd, s.shell
    FROM session_terminals st
    JOIN sessions s ON s.id = st.terminal_session_id
    WHERE st.session_id = ? AND st.status = 'active'
  `).all(sessionId) as any[];

  for (const t of linkedTerminals) {
    const lastCmd = db.prepare(
      "SELECT command, exit_code FROM command_events WHERE session_id = ? ORDER BY started_at DESC LIMIT 1"
    ).get(t.id) as any;
    t.last_command = lastCmd?.command || null;
    t.last_exit_code = lastCmd?.exit_code ?? null;
  }

  const tasks = db.prepare(
    "SELECT * FROM coordination_events WHERE session_id = ? AND status IN ('pending', 'claimed') ORDER BY created_at ASC"
  ).all(sessionId) as any[];

  let yourMentions: any[] = [];
  if (agentId) {
    const agent = db.prepare("SELECT handle, display_name FROM agent_registry WHERE id = ?").get(agentId) as any;
    if (agent) {
      const searchName = agent.handle || agent.display_name;
      yourMentions = db.prepare(`
        SELECT id, sender_name, content, created_at FROM messages
        WHERE session_id = ? AND content LIKE '%@' || ? || '%' AND role != 'system'
        ORDER BY created_at DESC LIMIT 10
      `).all(sessionId, searchName) as any[];
    }
  }

  res.json({
    session: { id: session.id, name: session.name, type: session.type, created_at: session.created_at },
    recent_messages: messages,
    members,
    linked_terminals: linkedTerminals,
    active_tasks: tasks.map((t: any) => ({
      id: t.id,
      description: JSON.parse(t.payload).task,
      assigned_to: t.target_agent_id,
      status: t.status,
      created_at: t.created_at,
    })),
    your_mentions: yourMentions,
  });
});

router.get("/api/v2/agent/:id/notifications", (req, res) => {
  const agentId = req.params.id;
  const since = req.query.since as string || "1970-01-01";

  const agent = db.prepare("SELECT handle, display_name FROM agent_registry WHERE id = ?").get(agentId) as any;
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  db.prepare("UPDATE agent_registry SET status = 'online', last_seen = datetime('now') WHERE id = ?").run(agentId);

  const notifications: any[] = [];

  const tasks = db.prepare(`
    SELECT * FROM coordination_events
    WHERE target_agent_id = ? AND status = 'pending' AND created_at > ?
    ORDER BY created_at ASC
  `).all(agentId, since) as any[];

  for (const t of tasks) {
    const payload = JSON.parse(t.payload);
    notifications.push({
      type: t.source === "mention" ? "mention" : "task",
      task_id: t.id,
      session_id: t.session_id || t.source_session_id,
      message_id: t.source_message_id || null,
      description: payload.task,
      from: payload.from || null,
      created_at: t.created_at,
    });
  }

  const searchName = agent.handle || agent.display_name;
  const memberSessions = db.prepare(
    "SELECT session_id FROM conversation_members WHERE agent_id = ?"
  ).all(agentId) as any[];

  if (memberSessions.length > 0) {
    const placeholders = memberSessions.map(() => "?").join(",");
    const mentions = db.prepare(`
      SELECT id, session_id, sender_name, sender_type, content, created_at
      FROM messages
      WHERE session_id IN (${placeholders})
        AND content LIKE '%@' || ? || '%'
        AND created_at > ?
        AND role != 'system'
      ORDER BY created_at ASC LIMIT 20
    `).all(...memberSessions.map((s: any) => s.session_id), searchName, since) as any[];

    for (const m of mentions) {
      if (notifications.some((n) => n.message_id === m.id)) continue;
      notifications.push({
        type: "mention",
        session_id: m.session_id,
        message_id: m.id,
        from: { name: m.sender_name, type: m.sender_type },
        content: m.content.length > 500 ? m.content.slice(0, 500) + "..." : m.content,
        created_at: m.created_at,
      });
    }
  }

  notifications.sort((a, b) => a.created_at.localeCompare(b.created_at));

  res.json({ agent_id: agentId, since, notifications });
});

// ---------------------------------------------------------------------------
// Middleware exports: lock checker + mention resolver for use in other routes
// ---------------------------------------------------------------------------

export function checkTerminalLock(sessionId: string, agentId?: string): { locked: boolean; holder?: string; expires_at?: string } {
  const lock = getActiveLock(sessionId);
  if (!lock) return { locked: false };
  if (agentId && lock.holder_agent === agentId) return { locked: false }; // holder can pass
  return { locked: true, holder: lock.holder_agent, expires_at: lock.expires_at };
}

export function resolveMentions(content: string, sessionId: string): Array<{
  agent_id: string;
  handle: string;
  display_name: string;
  matched: string;
  in_conversation: boolean;
}> {
  const mentionPattern = /@([\w][\w-]*)/g;
  const mentions: Array<{
    agent_id: string;
    handle: string;
    display_name: string;
    matched: string;
    in_conversation: boolean;
  }> = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(mentionPattern)) {
    const name = match[1];
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    // 1. Check conversation members first (highest priority)
    const member = db.prepare(`
      SELECT cm.agent_id, cm.handle, ar.display_name
      FROM conversation_members cm
      JOIN agent_registry ar ON ar.id = cm.agent_id
      WHERE cm.session_id = ? AND (cm.handle = ? COLLATE NOCASE OR ar.display_name = ? COLLATE NOCASE)
    `).get(sessionId, name, name) as { agent_id: string; handle: string; display_name: string } | undefined;

    if (member) {
      mentions.push({ agent_id: member.agent_id, handle: member.handle, display_name: member.display_name, matched: name, in_conversation: true });
      continue;
    }

    // 2. Check global agent registry by handle or display_name
    const globalAgent = db.prepare(`
      SELECT id, handle, display_name FROM agent_registry
      WHERE handle = ? COLLATE NOCASE OR display_name = ? COLLATE NOCASE
    `).get(name, name) as { id: string; handle: string | null; display_name: string } | undefined;

    if (globalAgent) {
      mentions.push({
        agent_id: globalAgent.id,
        handle: globalAgent.handle || globalAgent.display_name,
        display_name: globalAgent.display_name,
        matched: name,
        in_conversation: false,
      });
    }
    // If no match — just text, not a real agent mention. Skip.
  }

  return mentions;
}

export default router;
