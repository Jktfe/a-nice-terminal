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
// Single endpoint that accepts OpenAI-style function calls and routes them
// to the appropriate V2 endpoint. Serves Codex, vibeCLI, Lemonade,
// Perspective, Ollama — any model that speaks function-calling format.

interface FunctionCall {
  name: string;
  arguments: Record<string, any>;
}

const TOOL_ROUTES: Record<string, (args: Record<string, any>, req: any) => Promise<any>> = {
  // Session management
  list_sessions: async (args) => {
    const qs = args.include_archived ? "?include_archived=true" : "";
    return db.prepare(`SELECT * FROM sessions WHERE ${args.include_archived ? '1=1' : 'archived = 0'} ORDER BY updated_at DESC`).all();
  },
  get_session: async (args) => {
    return db.prepare("SELECT * FROM sessions WHERE id = ?").get(args.session_id);
  },
  get_dashboard: async () => {
    // Reuse the dashboard logic — fetch from our own endpoint internally
    return db.prepare("SELECT id, name, type, cwd, archived, tier, ttl_minutes, created_at, updated_at FROM sessions WHERE archived = 0 ORDER BY updated_at DESC").all();
  },

  // Terminal state (format-negotiated)
  get_terminal_state: async (args) => {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(args.session_id) as DbSession | undefined;
    if (!session) return { error: "Session not found" };
    const format = args.format || "structured";
    const seq = getTerminalOutputCursor(session.id);
    if (format === "summary") return buildSummary(session, seq);
    if (format === "structured") return buildStructured(session, seq);
    // raw
    const headless = getHeadless(session.id);
    if (!headless) return { error: "Terminal not attached", seq };
    const cursor = headless.getCursor();
    return { format: "raw", seq, lines: headless.getScreenLines(), cursorX: cursor.x, cursorY: cursor.y };
  },

  // Command history
  get_command_history: async (args) => {
    const limit = Math.min(args.limit || 20, 100);
    return db.prepare("SELECT * FROM command_events WHERE session_id = ? ORDER BY started_at DESC LIMIT ?")
      .all(args.session_id, limit);
  },

  // Knowledge
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

  // Lock management
  check_lock: async (args) => {
    const lock = getActiveLock(args.session_id);
    return lock ? { locked: true, holder: lock.holder_agent, expires_at: lock.expires_at } : { locked: false };
  },

  // Recipes
  list_recipes: async (args) => {
    const limit = Math.min(args.limit || 20, 100);
    return db.prepare("SELECT id, name, description, category, approved_by, use_count FROM recipes ORDER BY use_count DESC LIMIT ?").all(limit);
  },

  // Agents
  list_agents: async () => {
    return db.prepare("SELECT id, model_family, display_name, capabilities, status, last_seen FROM agent_registry ORDER BY last_seen DESC").all();
  },
};

router.post("/api/v2/agent/call", async (req, res) => {
  const { agent_id, calls } = req.body;

  if (!Array.isArray(calls) || calls.length === 0) {
    return res.status(400).json({ error: "calls array is required" });
  }

  // Update agent last_seen if registered
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

  res.json({
    agent_id,
    results,
    available_tools: Object.keys(TOOL_ROUTES),
  });
});

// GET /api/v2/agent/tools — list available tools for the gateway
router.get("/api/v2/agent/tools", (_req, res) => {
  res.json({
    tools: Object.keys(TOOL_ROUTES).map((name) => ({ name, type: "function" })),
    hint: "Call POST /api/v2/agent/call with { agent_id, calls: [{ name, arguments }] }",
  });
});

// ---------------------------------------------------------------------------
// Session Dashboard — enriched status for all sessions
// ---------------------------------------------------------------------------

router.get("/api/v2/sessions/dashboard", (_req, res) => {
  const sessions = db.prepare(
    "SELECT * FROM sessions WHERE archived = 0 ORDER BY updated_at DESC"
  ).all() as DbSession[];

  const result = sessions.map((s) => {
    const tracker = getCommandTracker(s.id);
    const isAlive = hasSession(s.id);

    // Determine status
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

    // Last activity: most recent terminal output or message
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

    // Preview: last line of output or last message snippet
    let preview = "";
    if (lastMessage) {
      preview = lastMessage.content.split("\n")[0].slice(0, 120);
    }

    // Linked terminals (for unified sessions)
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

// POST /api/v2/sessions/:id/promote — move session to a higher tier
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

// POST /api/v2/sessions/:id/demote — move session to a lower tier
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

// PATCH /api/v2/sessions/:id/tier — set tier directly
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
// Danger-checked exec — wraps existing exec with danger warning
// ---------------------------------------------------------------------------

// POST /api/v2/sessions/:id/exec — execute with danger check + intent tagging
router.post("/api/v2/sessions/:id/exec", async (req, res) => {
  const { command, acknowledge_danger, intent } = req.body;

  // Store intent on the command_events record if provided
  if (intent && typeof intent === "string") {
    // Will be picked up after exec completes — store in a temp map
    const intentMap = (req.app.get("_intentMap") || new Map()) as Map<string, string>;
    intentMap.set(`${req.params.id}:${command}`, intent);
    req.app.set("_intentMap", intentMap);
  }

  if (typeof command !== "string" || command.length === 0) {
    return res.status(400).json({ error: "command is required" });
  }

  // Check for dangerous patterns unless acknowledged or disabled
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

  // Forward to the existing agent exec endpoint via internal fetch
  // (reuse the same request to avoid duplicating the exec logic)
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

// GET /api/v2/dangerous-commands — list all danger patterns
router.get("/api/v2/dangerous-commands", (_req, res) => {
  const patterns = db.prepare("SELECT * FROM dangerous_commands ORDER BY severity DESC, pattern ASC").all();
  res.json(patterns);
});

// POST /api/v2/dangerous-commands — add a new danger pattern
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

// POST /api/v2/agents/register — register or update an agent
router.post("/api/v2/agents/register", (req, res) => {
  const { id, model_family, display_name, capabilities, preferred_formats, context_window, transport, gateway, underlying_model, api_base, config } = req.body;

  if (!id || !model_family || !display_name) {
    return res.status(400).json({ error: "id, model_family, and display_name are required" });
  }

  const existing = db.prepare("SELECT id FROM agent_registry WHERE id = ?").get(id);

  if (existing) {
    db.prepare(`
      UPDATE agent_registry SET
        model_family = ?, display_name = ?, capabilities = ?, preferred_formats = ?,
        context_window = ?, transport = ?, status = 'online', last_seen = datetime('now'),
        config = ?, gateway = ?, underlying_model = ?, api_base = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
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
      INSERT INTO agent_registry (id, model_family, display_name, capabilities, preferred_formats, context_window, transport, status, last_seen, config, gateway, underlying_model, api_base)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'online', datetime('now'), ?, ?, ?, ?)
    `).run(
      id, model_family, display_name,
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

// GET /api/v2/agents — list all registered agents
router.get("/api/v2/agents", (_req, res) => {
  const agents = db.prepare("SELECT * FROM agent_registry ORDER BY last_seen DESC").all();
  res.json(agents);
});

// GET /api/v2/agents/:id — get single agent
router.get("/api/v2/agents/:id", (req, res) => {
  const agent = db.prepare("SELECT * FROM agent_registry WHERE id = ?").get(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json(agent);
});

// DELETE /api/v2/agents/:id — unregister an agent
router.delete("/api/v2/agents/:id", (req, res) => {
  const result = db.prepare("DELETE FROM agent_registry WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Agent not found" });
  // Also release any locks held by this agent
  db.prepare("DELETE FROM terminal_locks WHERE holder_agent = ?").run(req.params.id);
  res.json({ deleted: true, id: req.params.id });
});

// POST /api/v2/agents/:id/heartbeat — keep agent online
router.post("/api/v2/agents/:id/heartbeat", (req, res) => {
  const result = db.prepare(
    "UPDATE agent_registry SET status = 'online', last_seen = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Agent not found" });
  res.json({ ok: true });
});

// POST /api/v2/agents/discover — re-run auto-discovery of local models
router.post("/api/v2/agents/discover", async (_req, res) => {
  try {
    const result = await registerDiscoveredModels();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "Discovery failed", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Beeper token endpoint (for MCP tools to retrieve cached token)
// ---------------------------------------------------------------------------

router.get("/api/v2/beeper/token", (_req, res) => {
  const tokenRow = db.prepare("SELECT value FROM server_state WHERE key = 'beeper_access_token'").get() as { value: string } | undefined;
  if (!tokenRow) return res.status(404).json({ error: "Beeper not authenticated" });
  res.json({ token: tokenRow.value });
});

// ---------------------------------------------------------------------------
// Terminal Screenshot (SVG)
// ---------------------------------------------------------------------------

// GET /api/v2/sessions/:id/terminal/screenshot — render terminal as SVG
router.get("/api/v2/sessions/:id/terminal/screenshot", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal" && session.type !== "unified") {
    return res.status(409).json({ error: "Not a terminal session" });
  }

  // For unified sessions, find the linked terminal
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

  // Render as SVG
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

  // Cursor indicator
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
    // Return as base64 for embedding in JSON responses
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

// POST /api/v2/sessions/:id/lock — acquire exclusive terminal access
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

  // Acquire or renew lock
  const safeDuration = Math.min(Math.max(duration_ms || LOCK_EXPIRY_MS, 10000), 30 * 60 * 1000); // 10s to 30min
  const expiresAt = new Date(Date.now() + safeDuration).toISOString();

  db.prepare(`
    INSERT OR REPLACE INTO terminal_locks (session_id, holder_agent, acquired_at, expires_at)
    VALUES (?, ?, datetime('now'), ?)
  `).run(session.id, agent_id, expiresAt);

  res.json({
    acquired: true,
    session_id: session.id,
    holder: agent_id,
    expires_at: expiresAt,
  });
});

// DELETE /api/v2/sessions/:id/lock — release terminal lock
router.delete("/api/v2/sessions/:id/lock", (req, res) => {
  const { agent_id } = req.body || {};

  const lock = getActiveLock(req.params.id);
  if (!lock) return res.json({ released: true, was_locked: false });

  // Only the holder (or anyone if no agent_id specified) can release
  if (agent_id && lock.holder_agent !== agent_id) {
    return res.status(403).json({
      error: "Not the lock holder",
      holder: lock.holder_agent,
    });
  }

  db.prepare("DELETE FROM terminal_locks WHERE session_id = ?").run(req.params.id);
  res.json({ released: true, was_locked: true, previous_holder: lock.holder_agent });
});

// GET /api/v2/sessions/:id/lock — check lock status
router.get("/api/v2/sessions/:id/lock", (req, res) => {
  const lock = getActiveLock(req.params.id);
  if (!lock) return res.json({ locked: false });
  res.json({
    locked: true,
    holder: lock.holder_agent,
    acquired_at: lock.acquired_at,
    expires_at: lock.expires_at,
  });
});

// ---------------------------------------------------------------------------
// User Preferences
// ---------------------------------------------------------------------------

// GET /api/v2/preferences — get learned preferences
router.get("/api/v2/preferences", (req, res) => {
  const { domain, user_id } = req.query;
  const userId = (user_id as string) || "default";

  let query = "SELECT * FROM user_preferences WHERE user_id = ?";
  const params: any[] = [userId];

  if (domain) { query += " AND domain = ?"; params.push(domain); }
  query += " ORDER BY strength DESC";

  res.json(db.prepare(query).all(...params));
});

// POST /api/v2/preferences — set a preference explicitly
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

// POST /api/v2/preferences/learn — trigger preference learning from command history
router.post("/api/v2/preferences/learn", (_req, res) => {
  // Count package manager usage
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

  // Count shell usage
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

// GET /api/v2/sessions/:id/resources — basic resource info for a terminal session
router.get("/api/v2/sessions/:id/resources", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });

  // Command count and error rate
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
      // Server-level process stats (not per-PTY, but useful)
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      uptime_s: Math.round(process.uptime()),
    },
  });
});

// ---------------------------------------------------------------------------
// Middleware export: lock checker for use in other routes
// ---------------------------------------------------------------------------

export function checkTerminalLock(sessionId: string, agentId?: string): { locked: boolean; holder?: string; expires_at?: string } {
  const lock = getActiveLock(sessionId);
  if (!lock) return { locked: false };
  if (agentId && lock.holder_agent === agentId) return { locked: false }; // holder can pass
  return { locked: true, holder: lock.holder_agent, expires_at: lock.expires_at };
}

export default router;
