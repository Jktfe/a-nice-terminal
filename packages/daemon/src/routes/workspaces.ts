import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import type { DbWorkspace } from "../types.js";

const router = Router();

// List workspaces
router.get("/api/workspaces", (_req, res) => {
  const workspaces = db
    .prepare("SELECT * FROM workspaces ORDER BY updated_at DESC")
    .all();
  res.json(workspaces);
});

// Create workspace
router.post("/api/workspaces", (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Workspace name is required" });
  }

  const id = nanoid(12);
  db.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)").run(id, name.trim());

  const workspace = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id);

  const io = req.app.get("io");
  if (io) io.emit("session_list_changed");

  res.status(201).json(workspace);
});

// Update workspace
router.patch("/api/workspaces/:id", (req, res) => {
  const { name } = req.body;
  const workspace = db
    .prepare("SELECT * FROM workspaces WHERE id = ?")
    .get(req.params.id) as DbWorkspace | undefined;

  if (!workspace) return res.status(404).json({ error: "Workspace not found" });

  if (name && typeof name === "string" && name.trim()) {
    db.prepare("UPDATE workspaces SET name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(name.trim(), req.params.id);
  }

  const updated = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(req.params.id);

  const io = req.app.get("io");
  if (io) io.emit("session_list_changed");

  res.json(updated);
});

// Delete workspace
router.delete("/api/workspaces/:id", (req, res) => {
  const result = db
    .prepare("DELETE FROM workspaces WHERE id = ?")
    .run(req.params.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Workspace not found" });
  }

  const io = req.app.get("io");
  if (io) io.emit("session_list_changed");

  res.json({ deleted: true });
});

export default router;
