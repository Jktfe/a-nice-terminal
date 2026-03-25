/**
 * Common Calls API — quick-copy command snippets.
 */
import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";

const router = Router();

// List all common calls
router.get("/api/common-calls", (_req, res) => {
  const calls = db.prepare("SELECT * FROM common_calls ORDER BY sort_order ASC, created_at ASC").all();
  res.json(calls);
});

// Create a common call
router.post("/api/common-calls", (req, res) => {
  const { name, command, sort_order } = req.body;
  if (!name || !command) {
    return res.status(400).json({ error: "name and command are required" });
  }

  const id = nanoid(12);
  db.prepare("INSERT INTO common_calls (id, name, command, sort_order) VALUES (?, ?, ?, ?)").run(
    id,
    name,
    command,
    sort_order ?? 0
  );

  const created = db.prepare("SELECT * FROM common_calls WHERE id = ?").get(id);
  res.status(201).json(created);
});

// Update a common call
router.patch("/api/common-calls/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM common_calls WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Common call not found" });

  const { name, command, sort_order } = req.body;
  const sets: string[] = [];
  const params: any[] = [];

  if (name !== undefined) { sets.push("name = ?"); params.push(name); }
  if (command !== undefined) { sets.push("command = ?"); params.push(command); }
  if (sort_order !== undefined) { sets.push("sort_order = ?"); params.push(sort_order); }

  if (sets.length === 0) return res.json(existing);

  params.push(req.params.id);
  db.prepare(`UPDATE common_calls SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  const updated = db.prepare("SELECT * FROM common_calls WHERE id = ?").get(req.params.id);
  res.json(updated);
});

// Delete a common call
router.delete("/api/common-calls/:id", (req, res) => {
  const result = db.prepare("DELETE FROM common_calls WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Common call not found" });
  res.json({ deleted: true });
});

export default router;
