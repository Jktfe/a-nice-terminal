/**
 * Tasks API — shared task board for the ANT task panel.
 *
 * GET    /api/tasks              — list all tasks (optional ?status= filter)
 * POST   /api/tasks              — create a task
 * PATCH  /api/tasks/:id          — update a task (title, description, status, assigned_to, assigned_name)
 * DELETE /api/tasks/:id          — delete a task
 *
 * All mutating routes emit a `task_changed` Socket.IO event so the Task Panel
 * updates live for every connected client.
 */
import { Router, type Request, type Response } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";

const router = Router();

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "done" | "blocked";
  assigned_to: string | null;
  assigned_name: string | null;
  created_at: string;
  updated_at: string;
};

function broadcast(req: Request, event: string, payload: unknown) {
  const io = req.app.get("io");
  if (io) io.emit(event, payload);
}

// List
router.get("/api/tasks", (req: Request, res: Response) => {
  const { status } = req.query;
  let tasks: Task[];
  if (status) {
    tasks = db
      .prepare("SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC")
      .all(status) as Task[];
  } else {
    tasks = db
      .prepare("SELECT * FROM tasks ORDER BY created_at ASC")
      .all() as Task[];
  }
  res.json(tasks);
});

// Create
router.post("/api/tasks", (req: Request, res: Response) => {
  const { title, description, status, assigned_to, assigned_name } = req.body;
  if (!title?.trim()) {
    return res.status(400).json({ error: "title is required" });
  }

  const id = nanoid(12);
  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, assigned_to, assigned_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    title.trim(),
    description ?? null,
    status ?? "todo",
    assigned_to ?? null,
    assigned_name ?? null,
    now,
    now
  );

  const created = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task;
  broadcast(req, "task_changed", { action: "created", task: created });
  res.status(201).json(created);
});

// Update
router.patch("/api/tasks/:id", (req: Request, res: Response) => {
  const existing = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(req.params.id) as Task | undefined;
  if (!existing) return res.status(404).json({ error: "Task not found" });

  const { title, description, status, assigned_to, assigned_name } = req.body;
  const sets: string[] = [];
  const params: unknown[] = [];

  if (title !== undefined) { sets.push("title = ?"); params.push(title); }
  if (description !== undefined) { sets.push("description = ?"); params.push(description); }
  if (status !== undefined) { sets.push("status = ?"); params.push(status); }
  if (assigned_to !== undefined) { sets.push("assigned_to = ?"); params.push(assigned_to); }
  if (assigned_name !== undefined) { sets.push("assigned_name = ?"); params.push(assigned_name); }

  if (sets.length === 0) return res.json(existing);

  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  sets.push("updated_at = ?");
  params.push(now);
  params.push(req.params.id);

  db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as Task;
  broadcast(req, "task_changed", { action: "updated", task: updated });
  res.json(updated);
});

// Delete
router.delete("/api/tasks/:id", (req: Request, res: Response) => {
  const existing = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(req.params.id) as Task | undefined;
  if (!existing) return res.status(404).json({ error: "Task not found" });

  db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
  broadcast(req, "task_changed", { action: "deleted", taskId: req.params.id });
  res.json({ deleted: true });
});

export default router;
