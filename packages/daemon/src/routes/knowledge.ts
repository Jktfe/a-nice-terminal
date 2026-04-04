/**
 * Knowledge API — self-learning ecosystem for ANT V2.
 *
 * Facts: atomic knowledge discovered by agents or humans.
 * Error patterns: failed commands linked to their fixes.
 * Knowledge links: cross-references between sessions, facts, commands.
 */
import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";

const router = Router();

// ---------------------------------------------------------------------------
// Facts — CRUD + search
// ---------------------------------------------------------------------------

// POST /api/v2/knowledge/facts — create or update a fact
router.post("/api/v2/knowledge/facts", (req, res) => {
  const { scope, category, key, value, confidence, source_session_id, source_agent, evidence, supersedes } = req.body;

  if (!category || !key || !value) {
    return res.status(400).json({ error: "category, key, and value are required" });
  }

  // Check for existing fact with same scope+category+key
  const existing = db.prepare(
    "SELECT * FROM knowledge_facts WHERE scope = ? AND category = ? AND key = ? ORDER BY confidence DESC LIMIT 1"
  ).get(scope || "global", category, key) as any;

  if (existing) {
    // Update existing fact — boost confidence
    const newConfidence = Math.min(1.0, (existing.confidence || 0.5) + 0.1);
    db.prepare(
      "UPDATE knowledge_facts SET value = ?, confidence = ?, source_agent = ?, confirmed_count = confirmed_count + 1, updated_at = datetime('now') WHERE id = ?"
    ).run(value, newConfidence, source_agent || existing.source_agent, existing.id);

    const updated = db.prepare("SELECT * FROM knowledge_facts WHERE id = ?").get(existing.id);
    return res.json(updated);
  }

  const id = nanoid(12);
  db.prepare(`
    INSERT INTO knowledge_facts (id, scope, category, key, value, confidence, source_session_id, source_agent, evidence, supersedes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    scope || "global",
    category,
    key,
    value,
    confidence ?? 0.5,
    source_session_id || null,
    source_agent || null,
    JSON.stringify(evidence || []),
    supersedes || null,
  );

  // Sync to FTS5
  try {
    db.prepare("INSERT INTO knowledge_facts_fts(rowid, key, value, category) VALUES ((SELECT rowid FROM knowledge_facts WHERE id = ?), ?, ?, ?)")
      .run(id, key, value, category);
  } catch { /* FTS sync is best-effort */ }

  const fact = db.prepare("SELECT * FROM knowledge_facts WHERE id = ?").get(id);
  res.status(201).json(fact);
});

// GET /api/v2/knowledge/facts — list facts with optional filters
router.get("/api/v2/knowledge/facts", (req, res) => {
  const { scope, category, limit: limitStr } = req.query;
  const limit = Math.min(parseInt(limitStr as string) || 50, 200);

  let query = "SELECT * FROM knowledge_facts WHERE 1=1";
  const params: any[] = [];

  if (scope) { query += " AND scope = ?"; params.push(scope); }
  if (category) { query += " AND category = ?"; params.push(category); }

  query += " ORDER BY confidence DESC, updated_at DESC LIMIT ?";
  params.push(limit);

  const facts = db.prepare(query).all(...params);
  res.json(facts);
});

// GET /api/v2/knowledge/search — full-text search across facts
router.get("/api/v2/knowledge/search", (req, res) => {
  const q = (req.query.q as string || "").trim();
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  if (!q) return res.status(400).json({ error: "q parameter required" });

  // Try FTS5 first. Wrap in phrase quotes so FTS5 operators (*, NOT, OR) in
  // the query string are treated as literals rather than query syntax.
  const ftsPhrase = `"${q.replace(/"/g, '""')}"`;
  try {
    const ftsResults = db.prepare(`
      SELECT kf.* FROM knowledge_facts kf
      JOIN knowledge_facts_fts fts ON kf.rowid = fts.rowid
      WHERE knowledge_facts_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsPhrase, limit);

    if (ftsResults.length > 0) return res.json(ftsResults);
  } catch {
    // FTS may not be available — fall through to LIKE
  }

  // Fallback: LIKE search
  const likePattern = `%${q}%`;
  const results = db.prepare(`
    SELECT * FROM knowledge_facts
    WHERE key LIKE ? OR value LIKE ? OR category LIKE ?
    ORDER BY confidence DESC
    LIMIT ?
  `).all(likePattern, likePattern, likePattern, limit);

  res.json(results);
});

// DELETE /api/v2/knowledge/facts/:id
router.delete("/api/v2/knowledge/facts/:id", (req, res) => {
  const result = db.prepare("DELETE FROM knowledge_facts WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Fact not found" });
  res.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Error patterns — record and query error→fix pairs
// ---------------------------------------------------------------------------

// POST /api/v2/knowledge/errors — report an error pattern with optional fix
router.post("/api/v2/knowledge/errors", (req, res) => {
  const { error_signature, error_regex, context_scope, fix_command, fix_description, fix_session_id, fix_agent } = req.body;

  if (!error_signature) return res.status(400).json({ error: "error_signature is required" });

  // Check for existing pattern
  const existing = db.prepare(
    "SELECT * FROM error_patterns WHERE error_signature = ? AND context_scope = ?"
  ).get(error_signature, context_scope || "global") as any;

  if (existing) {
    // Update with better fix info if provided
    if (fix_command) {
      db.prepare(
        "UPDATE error_patterns SET fix_command = ?, fix_description = ?, fix_agent = ?, success_count = success_count + 1, updated_at = datetime('now') WHERE id = ?"
      ).run(fix_command, fix_description || existing.fix_description, fix_agent || existing.fix_agent, existing.id);
    } else {
      db.prepare("UPDATE error_patterns SET failure_count = failure_count + 1, updated_at = datetime('now') WHERE id = ?").run(existing.id);
    }
    const updated = db.prepare("SELECT * FROM error_patterns WHERE id = ?").get(existing.id);
    return res.json(updated);
  }

  const id = nanoid(12);
  db.prepare(`
    INSERT INTO error_patterns (id, error_signature, error_regex, context_scope, fix_command, fix_description, fix_session_id, fix_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, error_signature, error_regex || null, context_scope || "global", fix_command || null, fix_description || null, fix_session_id || null, fix_agent || null);

  const pattern = db.prepare("SELECT * FROM error_patterns WHERE id = ?").get(id);
  res.status(201).json(pattern);
});

// GET /api/v2/knowledge/errors — search for known error patterns
router.get("/api/v2/knowledge/errors", (req, res) => {
  const sig = (req.query.signature as string || "").trim();
  const q = (req.query.q as string || "").trim();
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

  if (!sig && !q) return res.status(400).json({ error: "signature or q parameter required" });

  if (sig) {
    // Exact signature match first
    const exact = db.prepare("SELECT * FROM error_patterns WHERE error_signature = ? ORDER BY success_count DESC LIMIT ?").all(sig, limit);
    if (exact.length > 0) return res.json(exact);
  }

  // Fuzzy search: check if the query text contains any known error signatures
  const search = sig || q;
  const patterns = db.prepare("SELECT * FROM error_patterns ORDER BY success_count DESC LIMIT 200").all() as any[];

  const matches = patterns.filter((p) => {
    if (search.includes(p.error_signature)) return true;
    if (p.error_regex) {
      try { return new RegExp(p.error_regex, "i").test(search); } catch { return false; }
    }
    return false;
  }).slice(0, limit);

  res.json(matches);
});

// ---------------------------------------------------------------------------
// Knowledge links — cross-references
// ---------------------------------------------------------------------------

// POST /api/v2/knowledge/links
router.post("/api/v2/knowledge/links", (req, res) => {
  const { from_type, from_id, to_type, to_id, relation, metadata } = req.body;
  if (!from_type || !from_id || !to_type || !to_id || !relation) {
    return res.status(400).json({ error: "from_type, from_id, to_type, to_id, and relation are required" });
  }

  const id = nanoid(12);
  db.prepare("INSERT INTO knowledge_links (id, from_type, from_id, to_type, to_id, relation, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, from_type, from_id, to_type, to_id, relation, metadata ? JSON.stringify(metadata) : null);

  res.status(201).json({ id, from_type, from_id, to_type, to_id, relation });
});

// GET /api/v2/knowledge/links — query links for an entity
router.get("/api/v2/knowledge/links", (req, res) => {
  const { type, id, relation } = req.query;
  if (!type || !id) return res.status(400).json({ error: "type and id are required" });

  let query = "SELECT * FROM knowledge_links WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)";
  const params: any[] = [type, id, type, id];

  if (relation) { query += " AND relation = ?"; params.push(relation); }
  query += " ORDER BY created_at DESC LIMIT 50";

  res.json(db.prepare(query).all(...params));
});

export default router;
