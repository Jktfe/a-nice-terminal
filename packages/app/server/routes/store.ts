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

// ---------------------------------------------------------------------------
// V2: Full session export to Obsidian
// ---------------------------------------------------------------------------

router.post("/api/v2/sessions/:id/export/obsidian", (req, res) => {
  const vaultPath = getVaultPath();
  if (!vaultPath) return res.status(400).json({ error: "Obsidian vault path not configured" });

  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as any;
  if (!session) return res.status(404).json({ error: "Session not found" });

  const sessionName = session.name || "Untitled";
  const safeDate = (session.created_at || new Date().toISOString()).slice(0, 10);
  const filename = `ANT-${sanitiseFilename(sessionName)}-${safeDate}.md`;

  let fileContent: string;

  if (session.type === "terminal") {
    // Terminal: export as structured command log
    const commands = db.prepare(
      "SELECT * FROM command_events WHERE session_id = ? ORDER BY started_at ASC"
    ).all(session.id) as any[];

    const frontmatter = [
      "---",
      "source: ANT",
      "type: terminal-log",
      `session_id: ${session.id}`,
      `session_name: "${sessionName}"`,
      session.shell ? `shell: ${session.shell}` : null,
      session.cwd ? `cwd: ${session.cwd}` : null,
      `created: ${session.created_at}`,
      `tags: [ant/terminal]`,
      "---",
    ].filter(Boolean).join("\n");

    const commandLogs = commands.map((c) => {
      const exitInfo = c.exit_code === 0 ? "exit: 0" : c.exit_code != null ? `exit: ${c.exit_code}` : "running";
      const duration = c.duration_ms ? `${(c.duration_ms / 1000).toFixed(1)}s` : "";
      const time = c.started_at ? c.started_at.slice(11, 19) : "";
      const output = c.output ? c.output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").slice(0, 2000) : "";

      return `### \`${c.command}\` (${time}, ${exitInfo}${duration ? `, ${duration}` : ""})\n\`\`\`\n${output}\n\`\`\``;
    }).join("\n\n");

    fileContent = `${frontmatter}\n\n# ${sessionName} — Terminal Log\n\n${commandLogs || "No commands recorded."}\n`;
  } else {
    // Conversation or unified: export as chat transcript
    const messages = db.prepare(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC"
    ).all(session.id) as any[];

    // Collect unique participants
    const participants = new Set<string>();
    messages.forEach((m: any) => {
      if (m.sender_name) participants.add(m.sender_name);
      else if (m.role === "human") participants.add("User");
      else if (m.role === "agent") participants.add("Agent");
      else participants.add("System");
    });

    const frontmatter = [
      "---",
      "source: ANT",
      `type: ${session.type === "unified" ? "unified-session" : "conversation"}`,
      `session_id: ${session.id}`,
      `session_name: "${sessionName}"`,
      `participants: [${[...participants].join(", ")}]`,
      `created: ${session.created_at}`,
      `updated: ${session.updated_at}`,
      `tags: [ant/${session.type}]`,
      `aliases: ["${sessionName}"]`,
      "---",
    ].join("\n");

    const transcript = messages.map((m: any) => {
      const sender = m.sender_name || (m.role === "human" ? "User" : m.role === "agent" ? "Agent" : "System");
      const time = m.created_at ? m.created_at.slice(11, 16) : "";
      const msgType = m.message_type || "text";

      if (msgType === "command_result") {
        const meta = m.metadata ? JSON.parse(m.metadata) : {};
        const exitInfo = meta.exit_code === 0 ? "succeeded" : meta.exit_code != null ? `failed (${meta.exit_code})` : "running";
        return `### \`${meta.command || "command"}\` (${time}, ${exitInfo})\n\`\`\`\n${(m.content || "").slice(0, 2000)}\n\`\`\``;
      }

      return `### ${sender} (${time})\n${m.content}`;
    }).join("\n\n");

    fileContent = `${frontmatter}\n\n# ${sessionName}\n\n${transcript}\n`;
  }

  try {
    const antDir = path.join(vaultPath, "ANT");
    if (!existsSync(antDir)) mkdirSync(antDir, { recursive: true });

    const filePath = path.join(antDir, filename);
    writeFileSync(filePath, fileContent, "utf-8");

    res.json({ exported: true, path: filePath, filename });
  } catch (err: any) {
    console.error("[store] Failed to export to Obsidian:", err.message);
    res.status(500).json({ error: "Failed to write file", details: err.message });
  }
});

export default router;
