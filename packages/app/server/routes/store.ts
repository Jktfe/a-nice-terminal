import { Router } from "express";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import db from "../db.js";

const router = Router();

function getVaultPath(): string | null {
  const fromEnv = process.env.ANT_OBSIDIAN_VAULT;
  if (fromEnv) return fromEnv;
  const row = db.prepare("SELECT value FROM server_state WHERE key = 'obsidian_vault_path'").get() as { value: string } | undefined;
  return row?.value || null;
}

function sanitiseFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 100);
}

router.post("/api/store", (req, res) => {
  const { messageId, sessionId } = req.body;
  if (!messageId || !sessionId) {
    return res.status(400).json({ error: "messageId and sessionId required" });
  }

  const vaultPath = getVaultPath();
  if (!vaultPath) {
    return res.status(400).json({ error: "Obsidian vault path not configured" });
  }

  const msg = db.prepare("SELECT * FROM messages WHERE id = ? AND session_id = ?").get(messageId, sessionId) as any;
  if (!msg) return res.status(404).json({ error: "Message not found" });

  const session = db.prepare("SELECT name FROM sessions WHERE id = ?").get(sessionId) as { name: string } | undefined;
  const sessionName = session?.name || "Unknown";

  const timestamp = msg.created_at || new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  const filename = `ANT-${sanitiseFilename(sessionName)}-${safeTimestamp}.md`;

  const frontmatter = [
    "---",
    "source: ANT",
    `session: "${sessionName}"`,
    msg.sender_type ? `sender_type: ${msg.sender_type}` : null,
    msg.sender_name ? `sender_name: ${msg.sender_name}` : null,
    msg.sender_persona ? `persona: ${msg.sender_persona}` : null,
    `timestamp: ${timestamp}`,
    msg.thread_id ? "thread: true" : null,
    "---",
  ].filter(Boolean).join("\n");

  const fileContent = `${frontmatter}\n\n${msg.content}\n`;

  try {
    const antDir = path.join(vaultPath, "ANT");
    if (!existsSync(antDir)) mkdirSync(antDir, { recursive: true });

    const filePath = path.join(antDir, filename);
    writeFileSync(filePath, fileContent, "utf-8");

    res.json({ stored: true, path: filePath, filename });
  } catch (err: any) {
    console.error("[store] Failed to write to Obsidian vault:", err.message);
    res.status(500).json({ error: "Failed to write file", details: err.message });
  }
});

router.get("/api/settings/obsidian", (_req, res) => {
  const vaultPath = getVaultPath();
  res.json({ vault_path: vaultPath });
});

router.patch("/api/settings/obsidian", (req, res) => {
  const { vault_path } = req.body;
  if (typeof vault_path !== "string" || !vault_path.trim()) {
    return res.status(400).json({ error: "vault_path required" });
  }

  const resolved = vault_path.startsWith("~/")
    ? vault_path.replace(/^~/, process.env.HOME || "")
    : vault_path;

  if (!existsSync(resolved)) {
    return res.status(400).json({ error: "Path does not exist" });
  }

  db.prepare("INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)")
    .run("obsidian_vault_path", resolved);

  res.json({ vault_path: resolved });
});

export default router;
