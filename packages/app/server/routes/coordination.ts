/**
 * Coordination API — cross-agent task delegation and notifications.
 *
 * Tasks: broadcast with required capabilities → capability-matched agents
 * claim → execute → complete. Model-agnostic — works for MCP, function
 * calling, and REST agents.
 *
 * Notifications: forward to ntfy.sh for push notifications to configured devices.
 * Device tracking: multi-device awareness.
 */
import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { features } from "../feature-flags.js";

const router = Router();

const NTFY_URL = process.env.NTFY_URL || "https://ntfy.sh";
const NTFY_TOPIC = process.env.NTFY_TOPIC || process.env.ANT_NTFY_TOPIC;
const NOTIFY_VIA = process.env.ANT_NOTIFY_VIA || "beeper"; // "beeper" (default), "ntfy", or "both"
const BEEPER_URL = process.env.BEEPER_URL || "http://localhost:23373";
const BEEPER_NOTIFY_CHAT_ID = process.env.ANT_NOTIFY_CHAT_ID;

// ---------------------------------------------------------------------------
// Task Coordination
// ---------------------------------------------------------------------------

// POST /api/v2/tasks/broadcast — broadcast a task for capability-matched agents
router.post("/api/v2/tasks/broadcast", (req, res) => {
  const { session_id, task, required_capabilities, agent_id, target_agent_id, expires_in_ms } = req.body;

  if (!task) return res.status(400).json({ error: "task is required" });

  const id = nanoid(12);
  const expiresAt = expires_in_ms
    ? new Date(Date.now() + Math.min(expires_in_ms, 24 * 60 * 60 * 1000)).toISOString()
    : new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h default

  const payload = JSON.stringify({
    task,
    ...req.body.context && { context: req.body.context },
    ...req.body.artifacts && { artifacts: req.body.artifacts },
    ...req.body.priority && { priority: req.body.priority },
  });

  db.prepare(`
    INSERT INTO coordination_events (id, session_id, event_type, agent_id, target_agent_id, payload, required_capabilities, expires_at)
    VALUES (?, ?, 'task_available', ?, ?, ?, ?, ?)
  `).run(
    id,
    session_id || null,
    agent_id || null,
    target_agent_id || null,
    payload,
    JSON.stringify(required_capabilities || []),
    expiresAt,
  );

  // If targeted, notify the specific agent; otherwise, broadcast
  const io = req.app.get("io");
  if (io) io.emit("task_available", { id, task, required_capabilities, target_agent_id });

  res.status(201).json({ id, status: "pending", expires_at: expiresAt });
});

// GET /api/v2/agent/tasks — get tasks matching an agent's capabilities
router.get("/api/v2/agent/tasks", (req, res) => {
  const agentId = req.query.agent_id as string;

  // Clean expired tasks
  db.prepare("UPDATE coordination_events SET status = 'expired' WHERE status = 'pending' AND expires_at < datetime('now')").run();

  // Get pending tasks
  let tasks;
  if (agentId) {
    // Get agent capabilities
    const agent = db.prepare("SELECT capabilities FROM agent_registry WHERE id = ?").get(agentId) as { capabilities: string } | undefined;
    const agentCaps = agent ? JSON.parse(agent.capabilities) as string[] : [];

    // Fetch tasks targeted at this agent or matching capabilities
    const allPending = db.prepare(
      "SELECT * FROM coordination_events WHERE status = 'pending' ORDER BY created_at ASC"
    ).all() as any[];

    tasks = allPending.filter((t) => {
      // Targeted at this agent
      if (t.target_agent_id === agentId) return true;
      // No target + capabilities match
      if (!t.target_agent_id) {
        const required = JSON.parse(t.required_capabilities) as string[];
        if (required.length === 0) return true;
        return required.some((cap: string) => agentCaps.includes(cap));
      }
      return false;
    });
  } else {
    tasks = db.prepare(
      "SELECT * FROM coordination_events WHERE status = 'pending' ORDER BY created_at ASC LIMIT 50"
    ).all();
  }

  res.json(tasks.map((t: any) => ({
    ...t,
    payload: JSON.parse(t.payload),
    required_capabilities: JSON.parse(t.required_capabilities),
  })));
});

// POST /api/v2/tasks/:id/claim — claim a task
router.post("/api/v2/tasks/:id/claim", (req, res) => {
  const { agent_id } = req.body;
  if (!agent_id) return res.status(400).json({ error: "agent_id is required" });

  const task = db.prepare("SELECT * FROM coordination_events WHERE id = ? AND status = 'pending'").get(req.params.id) as any;
  if (!task) return res.status(404).json({ error: "Task not found or already claimed" });

  db.prepare("UPDATE coordination_events SET status = 'claimed', target_agent_id = ? WHERE id = ?")
    .run(agent_id, req.params.id);

  const io = req.app.get("io");
  if (io) io.emit("task_claimed", { id: req.params.id, agent_id });

  res.json({ claimed: true, task_id: req.params.id, agent_id });
});

// POST /api/v2/tasks/:id/complete — mark task as done
router.post("/api/v2/tasks/:id/complete", (req, res) => {
  const { agent_id, result, artifacts } = req.body;

  const task = db.prepare("SELECT * FROM coordination_events WHERE id = ?").get(req.params.id) as any;
  if (!task) return res.status(404).json({ error: "Task not found" });

  const payload = JSON.parse(task.payload);
  payload.result = result;
  payload.completed_by = agent_id;
  if (artifacts) payload.artifacts = artifacts;

  db.prepare("UPDATE coordination_events SET status = 'completed', payload = ? WHERE id = ?")
    .run(JSON.stringify(payload), req.params.id);

  const io = req.app.get("io");
  if (io) io.emit("task_completed", { id: req.params.id, agent_id, result });

  res.json({ completed: true, task_id: req.params.id });
});

// GET /api/v2/tasks/:id — get task details
router.get("/api/v2/tasks/:id", (req, res) => {
  const task = db.prepare("SELECT * FROM coordination_events WHERE id = ?").get(req.params.id) as any;
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json({ ...task, payload: JSON.parse(task.payload), required_capabilities: JSON.parse(task.required_capabilities) });
});

// ---------------------------------------------------------------------------
// Notifications (ntfy.sh)
// ---------------------------------------------------------------------------

// POST /api/v2/notify — send push notification
router.post("/api/v2/notify", async (req, res) => {
  const { title, body, priority, tags } = req.body;

  if (!body) return res.status(400).json({ error: "body is required" });
  if (!features.notifications()) return res.status(503).json({ error: "Notifications disabled (set ANT_ENABLE_NOTIFICATIONS=true to enable)" });

  const via = (req.body.via as string) || NOTIFY_VIA;
  const results: Record<string, any> = {};

  // Send via ntfy.sh
  if (via === "ntfy" || via === "both") {
    if (!NTFY_TOPIC) {
      results.ntfy = { error: "NTFY_TOPIC not configured" };
    } else {
      try {
        const ntfyRes = await fetch(`${NTFY_URL}/${NTFY_TOPIC}`, {
          method: "POST",
          headers: {
            "Title": title || "ANT",
            "Priority": String(priority || "default"),
            ...(tags ? { "Tags": Array.isArray(tags) ? tags.join(",") : tags } : {}),
          },
          body: body,
        });
        results.ntfy = ntfyRes.ok
          ? { sent: true, topic: NTFY_TOPIC }
          : { error: `ntfy ${ntfyRes.status}` };
      } catch (err: any) {
        results.ntfy = { error: err.message };
      }
    }
  }

  // Send via Beeper
  if (via === "beeper" || via === "both") {
    if (!BEEPER_NOTIFY_CHAT_ID) {
      results.beeper = { error: "ANT_NOTIFY_CHAT_ID not configured" };
    } else {
      try {
        // Read cached Beeper token from server_state
        const tokenRow = db.prepare("SELECT value FROM server_state WHERE key = 'beeper_access_token'").get() as { value: string } | undefined;
        if (!tokenRow) {
          results.beeper = { error: "Beeper not authenticated — start the bridge first" };
        } else {
          const prefix = title ? `**${title}**\n\n` : "";
          const beeperRes = await fetch(`${BEEPER_URL}/v1/chats/${encodeURIComponent(BEEPER_NOTIFY_CHAT_ID)}/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${tokenRow.value}`,
            },
            body: JSON.stringify({ text: `${prefix}${body}` }),
          });
          results.beeper = beeperRes.ok
            ? { sent: true, chatId: BEEPER_NOTIFY_CHAT_ID }
            : { error: `Beeper ${beeperRes.status}` };
        }
      } catch (err: any) {
        results.beeper = { error: err.message };
      }
    }
  }

  const anySent = Object.values(results).some((r: any) => r.sent);
  res.status(anySent ? 200 : 502).json({ via, ...results });
});

// ---------------------------------------------------------------------------
// Device Registration
// ---------------------------------------------------------------------------

// POST /api/v2/devices/register
router.post("/api/v2/devices/register", (req, res) => {
  const { device_id, device_type, device_name } = req.body;
  if (!device_id) return res.status(400).json({ error: "device_id is required" });

  db.prepare(`
    INSERT OR REPLACE INTO connected_devices (device_id, device_type, device_name, last_seen)
    VALUES (?, ?, ?, datetime('now'))
  `).run(device_id, device_type || "desktop", device_name || null);

  res.json({ registered: true, device_id });
});

// GET /api/v2/devices — list connected devices
router.get("/api/v2/devices", (_req, res) => {
  // Consider devices active if seen in last 5 minutes
  const devices = db.prepare(
    "SELECT * FROM connected_devices WHERE last_seen > datetime('now', '-5 minutes') ORDER BY last_seen DESC"
  ).all();
  res.json(devices);
});

// POST /api/v2/devices/:id/heartbeat
router.post("/api/v2/devices/:id/heartbeat", (req, res) => {
  db.prepare("UPDATE connected_devices SET last_seen = datetime('now') WHERE device_id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
