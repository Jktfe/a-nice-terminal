import { Router } from "express";
import db from "../db.js";

const router = Router();

// List all captured resume commands (newest first)
router.get("/api/resume-commands", (_req, res) => {
  const commands = db
    .prepare("SELECT * FROM resume_commands ORDER BY captured_at DESC")
    .all();
  res.json(commands);
});

// Delete a resume command
router.delete("/api/resume-commands/:id", (req, res) => {
  const result = db
    .prepare("DELETE FROM resume_commands WHERE id = ?")
    .run(req.params.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Resume command not found" });
  }

  res.json({ deleted: true });
});

export default router;
