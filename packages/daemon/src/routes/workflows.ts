/**
 * Workflows API — launch and monitor multi-terminal workflow instances.
 *
 * A workflow is a recipe run: each step in the recipe spawns one ANT session
 * and (if the Ghostty backend is available) opens a Ghostty tab for it.
 *
 * Recipe step schema (stored as JSON in recipes.steps):
 *   { title?: string, command?: string, cwd?: string, session_name?: string, depends_on?: number[] }
 */

import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";

interface RecipeStep {
  title?: string;
  command?: string;
  cwd?: string;
  session_name?: string;
  depends_on?: number[];
}

const router = Router();

// ─── List workflow instances ─────────────────────────────────────────────────

router.get("/api/v2/workflows", (_req, res) => {
  const rows = db.prepare(`
    SELECT wi.*, COUNT(wss.id) as step_count
    FROM workflow_instances wi
    LEFT JOIN workflow_step_sessions wss ON wss.workflow_id = wi.id
    GROUP BY wi.id
    ORDER BY wi.started_at DESC
    LIMIT 100
  `).all();
  res.json(rows);
});

// ─── Get workflow status ─────────────────────────────────────────────────────

router.get("/api/v2/workflows/:id", (req, res) => {
  const instance = db
    .prepare("SELECT * FROM workflow_instances WHERE id = ?")
    .get(req.params.id) as any;
  if (!instance) return res.status(404).json({ error: "Workflow not found" });

  // Fetch each step with its session's last command result
  const steps = db.prepare(`
    SELECT wss.*,
           s.name  AS session_name,
           s.cwd   AS session_cwd,
           s.archived,
           ce.command     AS last_command,
           ce.exit_code   AS last_exit_code,
           ce.completed_at AS last_completed_at
    FROM workflow_step_sessions wss
    JOIN sessions s ON s.id = wss.session_id
    LEFT JOIN command_events ce ON ce.session_id = wss.session_id
      AND ce.started_at = (
        SELECT MAX(started_at) FROM command_events WHERE session_id = wss.session_id
      )
    WHERE wss.workflow_id = ?
    ORDER BY wss.step_index ASC
  `).all(req.params.id) as any[];

  // Compute aggregate status
  const allDone = steps.length > 0 && steps.every((s) => s.last_exit_code !== null);
  const anyFailed = steps.some((s) => s.last_exit_code !== null && s.last_exit_code !== 0);
  const computedStatus = anyFailed ? "failed" : allDone ? "done" : "running";

  // Update DB status if it changed
  if (computedStatus !== instance.status && instance.status === "running") {
    db.prepare("UPDATE workflow_instances SET status = ?, finished_at = datetime('now') WHERE id = ?")
      .run(computedStatus, req.params.id);
    instance.status = computedStatus;
  }

  res.json({ ...instance, steps });
});

// ─── Launch workflow ─────────────────────────────────────────────────────────

router.post("/api/v2/workflows/launch", async (req, res) => {
  const { recipe_id, params: paramValues = {} } = req.body as {
    recipe_id: string;
    params?: Record<string, string>;
  };

  if (!recipe_id) return res.status(400).json({ error: "recipe_id is required" });

  const recipe = db
    .prepare("SELECT * FROM recipes WHERE id = ?")
    .get(recipe_id) as any;
  if (!recipe) return res.status(404).json({ error: "Recipe not found" });

  let steps: RecipeStep[];
  try {
    steps = JSON.parse(recipe.steps) as RecipeStep[];
  } catch {
    return res.status(422).json({ error: "Recipe steps are not valid JSON" });
  }

  if (steps.length === 0) {
    return res.status(422).json({ error: "Recipe has no steps" });
  }

  // Create workflow instance
  const workflowId = nanoid(12);
  db.prepare(`
    INSERT INTO workflow_instances (id, recipe_id, recipe_name)
    VALUES (?, ?, ?)
  `).run(workflowId, recipe_id, recipe.name);

  // Try to get the terminal backend (Ghostty) — optional
  let backend: any | null = null;
  try {
    const { getTerminalBackend } = await import("../terminal-orchestrator/index.js");
    const b = getTerminalBackend();
    if (await b.isAvailable()) backend = b;
  } catch {
    // Terminal backend not available — sessions will be created but no Ghostty tabs
  }

  const createdSteps: Array<{ step_index: number; session_id: string; title: string }> = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Interpolate params into command and cwd
    let command = step.command ?? "";
    let cwd = step.cwd ?? process.cwd();
    for (const [k, v] of Object.entries(paramValues)) {
      command = command.replaceAll(`{{${k}}}`, v);
      cwd = cwd.replaceAll(`{{${k}}}`, v);
    }

    const stepTitle = step.title ?? `Step ${i + 1}`;
    const sessionName = step.session_name ?? `${recipe.name}-step-${i + 1}-${workflowId.slice(0, 6)}`;

    // Create an ANT terminal session for this step
    const sessionId = nanoid(16);
    db.prepare(`
      INSERT INTO sessions (id, name, type, shell, cwd, created_at, updated_at)
      VALUES (?, ?, 'terminal', NULL, ?, datetime('now'), datetime('now'))
    `).run(sessionId, sessionName, cwd || null);

    // Record the step → session mapping
    const stepRowId = nanoid(12);
    db.prepare(`
      INSERT INTO workflow_step_sessions (id, workflow_id, step_index, step_title, session_id, depends_on)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(stepRowId, workflowId, i, stepTitle, sessionId, JSON.stringify(step.depends_on ?? []));

    createdSteps.push({ step_index: i, session_id: sessionId, title: stepTitle });

    // Open a Ghostty tab if backend is available
    if (backend) {
      try {
        await backend.create({
          sessionId,
          cwd: cwd || undefined,
          command: command || undefined,
          title: `[${i + 1}/${steps.length}] ${stepTitle}`,
        });
      } catch (err) {
        console.warn(`[workflows] Ghostty create failed for step ${i}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  // Increment recipe use count
  db.prepare("UPDATE recipes SET use_count = use_count + 1 WHERE id = ?").run(recipe_id);

  res.status(201).json({
    workflow_id: workflowId,
    recipe_name: recipe.name,
    steps: createdSteps,
    ghostty_available: backend !== null,
  });
});

// ─── Cancel / mark done ──────────────────────────────────────────────────────

router.patch("/api/v2/workflows/:id", (req, res) => {
  const { status } = req.body as { status?: string };
  const allowed = ["running", "done", "failed", "cancelled"];
  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
  }

  const instance = db
    .prepare("SELECT id FROM workflow_instances WHERE id = ?")
    .get(req.params.id);
  if (!instance) return res.status(404).json({ error: "Workflow not found" });

  db.prepare(`
    UPDATE workflow_instances SET status = ?, finished_at = CASE WHEN ? != 'running' THEN datetime('now') ELSE NULL END
    WHERE id = ?
  `).run(status, status, req.params.id);

  res.json({ id: req.params.id, status });
});

export default router;
