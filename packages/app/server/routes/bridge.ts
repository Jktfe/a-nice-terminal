import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";

const router = Router();

// List all bridge mappings (optionally filter by platform)
router.get("/api/bridge/mappings", (req, res) => {
  const { platform } = req.query;
  let query = "SELECT * FROM bridge_mappings";
  const params: any[] = [];

  if (platform) {
    query += " WHERE platform = ?";
    params.push(platform);
  }

  query += " ORDER BY created_at DESC";
  const mappings = db.prepare(query).all(...params).map((m: any) => ({
    ...m,
    config: m.config ? JSON.parse(m.config) : null,
  }));
  res.json(mappings);
});

// Create a bridge mapping
router.post("/api/bridge/mappings", (req, res) => {
  const { platform, external_channel_id, session_id, external_channel_name, direction, config, bot_type, agent_id } = req.body;

  if (!platform || !external_channel_id || !session_id) {
    return res.status(400).json({ error: "platform, external_channel_id, and session_id are required" });
  }

  // Verify session exists
  const session = db.prepare("SELECT id FROM sessions WHERE id = ?").get(session_id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const id = nanoid(12);
  try {
    db.prepare(
      `INSERT INTO bridge_mappings (id, platform, external_channel_id, session_id, external_channel_name, direction, config, bot_type, agent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      platform,
      String(external_channel_id),
      session_id,
      external_channel_name || null,
      direction || "bidirectional",
      config ? JSON.stringify(config) : null,
      bot_type || "relay",
      agent_id || null,
    );
  } catch (err: any) {
    if (err.message?.includes("UNIQUE constraint failed")) {
      return res.status(409).json({ error: "Mapping already exists for this platform and channel" });
    }
    throw err;
  }

  const mapping = db.prepare("SELECT * FROM bridge_mappings WHERE id = ?").get(id) as any;
  if (mapping.config) mapping.config = JSON.parse(mapping.config);
  res.status(201).json(mapping);
});

// Delete a bridge mapping
router.delete("/api/bridge/mappings/:id", (req, res) => {
  const result = db.prepare("DELETE FROM bridge_mappings WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "Mapping not found" });
  }
  res.json({ deleted: true });
});

// Get mappings for a session
router.get("/api/bridge/mappings/by-session/:sid", (req, res) => {
  const mappings = db.prepare(
    "SELECT * FROM bridge_mappings WHERE session_id = ? ORDER BY created_at DESC"
  ).all(req.params.sid).map((m: any) => ({
    ...m,
    config: m.config ? JSON.parse(m.config) : null,
  }));
  res.json(mappings);
});

// Lookup by external channel
router.get("/api/bridge/mappings/by-channel/:platform/:channelId", (req, res) => {
  const mapping = db.prepare(
    "SELECT * FROM bridge_mappings WHERE platform = ? AND external_channel_id = ?"
  ).get(req.params.platform, req.params.channelId) as any;

  if (!mapping) {
    return res.status(404).json({ error: "No mapping found" });
  }

  if (mapping.config) mapping.config = JSON.parse(mapping.config);
  res.json(mapping);
});

export default router;
