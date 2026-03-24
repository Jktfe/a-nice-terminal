/**
 * Recipes API — reusable multi-step workflows.
 *
 * Recipes are auto-captured from positively-rated sessions or
 * proposed by agents. Humans approve before they become available.
 * Execution substitutes {{params}} and runs steps sequentially.
 */
import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";

const router = Router();

interface DbRecipe {
  id: string;
  name: string;
  description: string | null;
  scope: string;
  category: string | null;
  steps: string;
  source_session_id: string | null;
  source_agent: string | null;
  approved_by: string | null;
  use_count: number;
  success_rate: number | null;
  created_at: string;
  updated_at: string;
}

interface DbRecipeParam {
  id: string;
  recipe_id: string;
  name: string;
  description: string | null;
  default_value: string | null;
  required: number;
}

// GET /api/v2/recipes — list recipes
router.get("/api/v2/recipes", (req, res) => {
  const { scope, category, approved } = req.query;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

  let query = "SELECT * FROM recipes WHERE 1=1";
  const params: any[] = [];

  if (scope) { query += " AND scope = ?"; params.push(scope); }
  if (category) { query += " AND category = ?"; params.push(category); }
  if (approved === "true") { query += " AND approved_by IS NOT NULL"; }
  if (approved === "false") { query += " AND approved_by IS NULL"; }

  query += " ORDER BY use_count DESC, created_at DESC LIMIT ?";
  params.push(limit);

  const recipes = db.prepare(query).all(...params) as DbRecipe[];

  // Attach params
  const result = recipes.map((r) => ({
    ...r,
    steps: JSON.parse(r.steps),
    params: db.prepare("SELECT * FROM recipe_params WHERE recipe_id = ?").all(r.id) as DbRecipeParam[],
  }));

  res.json(result);
});

// GET /api/v2/recipes/:id — get single recipe with params
router.get("/api/v2/recipes/:id", (req, res) => {
  const recipe = db.prepare("SELECT * FROM recipes WHERE id = ?").get(req.params.id) as DbRecipe | undefined;
  if (!recipe) return res.status(404).json({ error: "Recipe not found" });

  const params = db.prepare("SELECT * FROM recipe_params WHERE recipe_id = ?").all(recipe.id) as DbRecipeParam[];
  res.json({ ...recipe, steps: JSON.parse(recipe.steps), params });
});

// POST /api/v2/recipes — create/propose a recipe
router.post("/api/v2/recipes", (req, res) => {
  const { name, description, scope, category, steps, source_agent, params: recipeParams } = req.body;

  if (!name || !steps || !Array.isArray(steps)) {
    return res.status(400).json({ error: "name and steps (array) are required" });
  }

  const id = nanoid(12);
  db.prepare(`
    INSERT INTO recipes (id, name, description, scope, category, steps, source_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, description || null, scope || "global", category || null, JSON.stringify(steps), source_agent || null);

  // Add params if provided
  if (Array.isArray(recipeParams)) {
    const insertParam = db.prepare("INSERT INTO recipe_params (id, recipe_id, name, description, default_value, required) VALUES (?, ?, ?, ?, ?, ?)");
    for (const p of recipeParams) {
      insertParam.run(nanoid(8), id, p.name, p.description || null, p.default_value || null, p.required ? 1 : 0);
    }
  }

  const recipe = db.prepare("SELECT * FROM recipes WHERE id = ?").get(id) as DbRecipe;
  const params = db.prepare("SELECT * FROM recipe_params WHERE recipe_id = ?").all(id) as DbRecipeParam[];
  res.status(201).json({ ...recipe, steps: JSON.parse(recipe.steps), params });
});

// POST /api/v2/recipes/:id/approve — approve a recipe
router.post("/api/v2/recipes/:id/approve", (req, res) => {
  const { approved_by } = req.body;
  const result = db.prepare("UPDATE recipes SET approved_by = ?, updated_at = datetime('now') WHERE id = ?")
    .run(approved_by || "human", req.params.id);

  if (result.changes === 0) return res.status(404).json({ error: "Recipe not found" });

  const recipe = db.prepare("SELECT * FROM recipes WHERE id = ?").get(req.params.id);
  res.json(recipe);
});

// POST /api/v2/recipes/:id/run — execute a recipe (returns step plan, actual execution done via agent exec)
router.post("/api/v2/recipes/:id/run", (req, res) => {
  const recipe = db.prepare("SELECT * FROM recipes WHERE id = ?").get(req.params.id) as DbRecipe | undefined;
  if (!recipe) return res.status(404).json({ error: "Recipe not found" });

  const steps = JSON.parse(recipe.steps) as Array<{ command: string; description: string; interactive?: boolean }>;
  const params = req.body.params || {};

  // Substitute {{param}} placeholders
  const resolvedSteps = steps.map((step, index) => {
    let command = step.command;
    for (const [key, value] of Object.entries(params)) {
      command = command.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(value));
    }
    return {
      step: index + 1,
      command,
      description: step.description,
      interactive: step.interactive || false,
    };
  });

  // Check for unresolved params
  const unresolvedSteps = resolvedSteps.filter((s) => /\{\{[^}]+\}\}/.test(s.command));
  if (unresolvedSteps.length > 0) {
    const missingParams = unresolvedSteps.flatMap((s) => {
      const matches = s.command.match(/\{\{([^}]+)\}\}/g) || [];
      return matches.map((m) => m.replace(/[{}]/g, ""));
    });
    return res.status(400).json({
      error: "Missing required parameters",
      missing: [...new Set(missingParams)],
      hint: "Pass these in the params object",
    });
  }

  // Increment use count
  db.prepare("UPDATE recipes SET use_count = use_count + 1, updated_at = datetime('now') WHERE id = ?").run(recipe.id);

  res.json({
    recipe_id: recipe.id,
    recipe_name: recipe.name,
    total_steps: resolvedSteps.length,
    steps: resolvedSteps,
    hint: "Execute each step sequentially using ant_safe_exec or ant_exec_command. Skip interactive steps or handle them manually.",
  });
});

// DELETE /api/v2/recipes/:id
router.delete("/api/v2/recipes/:id", (req, res) => {
  const result = db.prepare("DELETE FROM recipes WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Recipe not found" });
  res.json({ deleted: true });
});

export default router;
