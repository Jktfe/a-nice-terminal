/**
 * Retention API — settings, digests, and manual sweep trigger.
 */
import { Router } from "express";
import db from "../db.js";
import {
  getRetentionSettings,
  updateRetentionSettings,
  runRetentionSweep,
  parseSessionForKnowledge,
} from "../retention.js";

const router = Router();

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

router.get("/api/retention/settings", (_req, res) => {
  res.json(getRetentionSettings());
});

router.patch("/api/retention/settings", (req, res) => {
  const updated = updateRetentionSettings(req.body);
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Manual sweep trigger
// ---------------------------------------------------------------------------

router.post("/api/retention/run", async (req, res) => {
  try {
    const io = req.app.get("io");
    const result = await runRetentionSweep(io);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Sweep failed" });
  }
});

// ---------------------------------------------------------------------------
// Session Digests — CRUD + search
// ---------------------------------------------------------------------------

router.get("/api/retention/digests", (req, res) => {
  const q = (req.query.q as string || "").trim();
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  if (q) {
    // Try FTS5 first
    try {
      const ftsResults = db.prepare(`
        SELECT sd.* FROM session_digests sd
        JOIN session_digests_fts fts ON sd.rowid = fts.rowid
        WHERE session_digests_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(q, limit);

      if (ftsResults.length > 0) return res.json(ftsResults);
    } catch {
      // FTS may not be available — fall through to LIKE
    }

    // Fallback: LIKE search
    const likePattern = `%${q}%`;
    const results = db.prepare(`
      SELECT * FROM session_digests
      WHERE session_name LIKE ? OR summary LIKE ? OR key_learnings LIKE ? OR tags LIKE ?
      ORDER BY parsed_at DESC
      LIMIT ?
    `).all(likePattern, likePattern, likePattern, likePattern, limit);

    return res.json(results);
  }

  // No query — return recent digests
  const digests = db.prepare(
    "SELECT * FROM session_digests ORDER BY parsed_at DESC LIMIT ?"
  ).all(limit);

  res.json(digests);
});

router.get("/api/retention/digests/:id", (req, res) => {
  const digest = db.prepare("SELECT * FROM session_digests WHERE id = ?").get(req.params.id);
  if (!digest) return res.status(404).json({ error: "Digest not found" });
  res.json(digest);
});

router.delete("/api/retention/digests/:id", (req, res) => {
  const result = db.prepare("DELETE FROM session_digests WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Digest not found" });
  res.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Parse a specific session (for "Parse & Delete" UI flow)
// ---------------------------------------------------------------------------

router.post("/api/sessions/:id/parse", async (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  try {
    const result = await parseSessionForKnowledge(req.params.id);
    if (!result) {
      return res.status(422).json({ error: "Session has no content to parse" });
    }

    const digest = db.prepare("SELECT * FROM session_digests WHERE id = ?").get(result.digestId);
    res.json({ digest, factsEmitted: result.factsEmitted });
  } catch (err: any) {
    res.status(502).json({ error: err.message || "LLM parsing failed" });
  }
});

export default router;
