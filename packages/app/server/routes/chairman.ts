import { Router } from "express";
import db from "../db.js";

const router = Router();

const DEFAULT_MODEL = process.env.CHAIRMAN_MODEL || "openai/gpt-oss-20b";
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || "http://localhost:1234";

function getSetting(key: string, fallback: string): string {
  const row = db.prepare("SELECT value FROM server_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

function setSetting(key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)").run(key, value);
}

// GET /api/chairman/status — current enabled state + model + session
router.get("/api/chairman/status", (_req, res) => {
  res.json({
    enabled: getSetting("chairman_enabled", "0") === "1",
    model: getSetting("chairman_model", DEFAULT_MODEL),
    session: getSetting("chairman_session", ""),
  });
});

// POST /api/chairman/toggle — flip enabled state
router.post("/api/chairman/toggle", (_req, res) => {
  const current = getSetting("chairman_enabled", "0");
  const next = current === "1" ? "0" : "1";
  setSetting("chairman_enabled", next);
  res.json({ enabled: next === "1" });
});

// POST /api/chairman/model — set active model
router.post("/api/chairman/model", (req, res) => {
  const { model } = req.body;
  if (!model?.trim()) return res.status(400).json({ error: "model is required" });
  setSetting("chairman_model", model.trim());
  res.json({ model: model.trim() });
});

// GET /api/chairman/models — proxy to LM Studio /v1/models
router.get("/api/chairman/models", async (_req, res) => {
  try {
    const r = await fetch(`${LM_STUDIO_URL}/v1/models`);
    if (!r.ok) throw new Error(`LM Studio responded ${r.status}`);
    const data = (await r.json()) as { data: Array<{ id: string }> };
    res.json({ models: data.data.map((m) => m.id) });
  } catch (err: any) {
    res.status(502).json({ error: "Cannot reach LM Studio", detail: err.message });
  }
});

// POST /api/chairman/session — set which conversation session to watch
router.post("/api/chairman/session", (req, res) => {
  const { session } = req.body;
  if (!session?.trim()) return res.status(400).json({ error: "session is required" });
  setSetting("chairman_session", session.trim());
  res.json({ session: session.trim() });
});

export default router;
